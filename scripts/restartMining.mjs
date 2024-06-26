import axios from 'axios'
import * as fs from 'node:fs'
import log4js from 'log4js'
import stream from 'stream'
import { promisify } from 'util'
import { exec } from 'child_process'
import cron from 'node-cron'
import pkg from 'mongodb'
const { MongoClient } = pkg


log4js.configure({
        levels: {
        CONS: { value: 9000, colour: 'magenta' },
        ECON: { value: 8000, colour: 'blue' },
        PERF: { value: 7000, colour: 'white' },
    },
    appenders: {
        out: { type: 'stdout', layout: {
            type: 'pattern',
            pattern: '%[%d{hh:mm:ss.SSS} [%p]%] %m',
        }},
        file: {
            type: 'file',
            filename: '/avalon/log/restart_script.log',
            maxLogSize: 10485760,
            backups: 3,
            compress: true
        }
    },
    categories: {
        console: { appenders: ['out'], level: 'trace' },
        default: { 
            appenders: ['out', 'file'],
            level: process.env.LOG_LEVEL || 'info'
        }
    }
  });


const logr = log4js.getLogger();

// https://stackoverflow.com/a/61269447  ===> CC BY-SA 4.0

const finished = promisify(stream.finished);

async function downloadFile(fileUrl, outputLocationPath) {
  const writer = fs.createWriteStream(outputLocationPath);
  return axios({
    method: 'get',
    url: fileUrl,
    responseType: 'stream',
  }).then(response => {
    response.data.pipe(writer);
    return finished(writer); //this is a Promise
  });
}
// END OF COPY-PASTED, SLIGHTLY MODIFIED CODE WITH CC BY-SA 4.0 LICENSE <===

const db_name = process.env.DB_NAME || 'avalon'
const db_url = process.env.DB_URL || 'mongodb://localhost:27017'

const genesisFilePath = "/avalon/genesis/genesis.zip"
const backupUrlMain = process.env.BACKUP_URL || "https://dtube.fso.ovh/"
const backupUrlOrig = "https://backup.d.tube/"

let createNet = parseInt(process.env.CREATE_NET || 0)
let shouldGetGenesisBlocks = parseInt(process.env.GET_GENESIS_BLOCKS || 0)

let replayState = parseInt(process.env.REPLAY_STATE || 0)
let rebuildState = parseInt(process.env.REBUILD_STATE || 0)
let rebuildNoVerify = parseInt(process.env.REBUILD_NO_VERIFY || 0)
let rebuildNoValidate = parseInt(process.env.REBUILD_NO_VALIDATE || 0)
const disableRestartScript = parseInt(process.env.DISABLE_RESTART_SCRIPT || 0)
let replayCheck = 0
let rebuildUnfinished = 0

if (rebuildState) {
    replayState = 0
    rebuildUnfinished = 1
}

let config = {
    host: 'http://localhost',
    port: process.env.HTTP_PORT || '3001',
    homeDir: "/home/ec2-user/",
    testnetDir: "/home/ec2-user/avalon_testnet/tavalon/avalon_testnet/",
    mainnetDir: "/home/ec2-user/tavalon/avalon/",
    scriptPath: "./scripts/start_mainnet.sh",
    logPath: "/avalon/log/avalon.log",
    replayLogPath: "/avalon/log/avalon_replay.log",
    backupUrl: backupUrlOrig + "$(TZ=GMT date +\"%d%h%Y_%H\").tar.gz",
    blockBackupUrl: backupUrlMain + "blocks.bson",
    genesisSourceUrl: backupUrlMain + "genesis.zip",
    mongodbPath: "/data/db"
}

let curbHeight = 0
let prevbHeight = 0
var replayFromDatabaseCount = 0
var reRunCount = 0
// try restarting before replaying for non-zero same height
let tryRestartForSameHeight = 3
let restartThreshold = 3
let sameHeightCount = 0
// How many times same height before replaying from database
var sameHeightThreshold = 5
var replayCount = 0
// How many times replay from database before rebuilding state
var replayCountMax = 5


var mongo = {
    db: null,
    init: (cb) => {
        MongoClient.connect(db_url, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        }, function(err, client) {
            if (err) throw err
            mongo.db = client.db(db_name)
            logr.info('Connected to '+db_url+'/'+mongo.db.databaseName)
            cb()
        })
    },
    dropDatabase: (cb) => {
        mongo.db.dropDatabase(function() {
            logr.info("Dropped avalon mongo db.")
            if (typeof cb == 'function') {
                cb()
            }
        })
    },
    getHeadBlock: () => {
        if (mongo.db !== null && typeof mongo.db.state !== 'undefined') {
            let blockState = mongo.db.state.findOne({"_id": 1})
            return blockState.headBlock
        }
        return -1
    }
}

function getCurTime() {
    var td = new Date()
    var d = String(td.getDate()).padStart(2, '0')
    var m = String(td.getMonth()).padStart(2, '0')

    var y = String(td.getFullYear())
    var h = String(td.getHours()).padStart(2, '0')
    var mn = String(td.getMinutes()).padStart(2, '0')
    var s = String(td.getSeconds()).padStart(2, '0')

    var dt = y + "/" + m + "/" + d + " " + h + ":" + mn + ":" + s
    return dt
}

function runCmd(cmdStr) {
    exec(cmdStr,
        function (error, stdout, stderr) {
            if (error !== null) {
                logr.info('exec error: ' + error);
                logr.info('stdout: ' + stdout);
                logr.info('stderr: ' + stderr);
            }
        }
    );
}

function getUrl() {
    var url = config.host + ":" + config.port
    return url
}

// sleep time expects milliseconds
function sleep (time) {
   return new Promise((resolve) => setTimeout(resolve, time));
}

function replayFromSelfBackup() {
    backupUrl = config.mongodbPath + "/backup"
}

async function checkBlocksFlow(time = 30000) {
    const blocks = mongo.getHeadBlock()
    sleep(time)
    if (mongo.getHeadBlock() > blocks) {
        return true
    } else {
        return false
    }
}

async function getGenesisBlocks() {
    return new Promise((resolve, reject) => {
        mongo.init(()=> {
            if (mongo.getHeadBlock() > 0) {
                logr.info("Skipping getGenesisBlock as we already have block data.")
            } else {
                logr.info("Genesis collection started.")
                logr.info("Dropping avalon mongo db (getting genesis blocks)")
                mongo.dropDatabase()
            }
        })
        if (fs.existsSync(genesisFilePath) || mongo.getHeadBlock() > 0) {
            logr.info("Genesis.zip already exists")
            shouldGetGenesisBlocks = 0
            resolve(true)
        } else {
            logr.info("Getting genesis.zip")
            shouldGetGenesisBlocks = 0
            let cmd = "cd /avalon"
            cmd += " && "
            cmd += "if [[ ! -d \"/avalon/genesis\" ]]; then `mkdir -p /avalon/genesis`; fi;"
            runCmd(cmd)
            downloadFile(config.genesisSourceUrl, "/avalon/genesis/genesis.zip").then(()=>{resolve(true)})
        }
    })
}

async function downloadBlocksFile(cb) {
    let mtime = null
    if (fs.existsSync('/data/avalon/blocks/blocks.bson')) {
        mtime = fs.statSync('/data/avalon/blocks/blocks.bson', (error, stats) => {
            if(error) {
                console.log(error)
            } else {
                return stats.mtime.getTime()
            }
        })
    } else {
        mtime = 0;
    }
    if(Date.now() - mtime > 86400000*10 && parseInt(process.env.CREATE_NET) != 1) { // if the file is older than 10 day(s), then re-download it.
        const backupUrl = config.blockBackupUrl
        logr.info("Downloading blocks.bson file... it may take a while.")
        await downloadFile(backupUrl, "/data/avalon/blocks/blocks.bson").then(() =>{
            if (typeof cb == 'function') {
                cb()
            }
            return true;
        })
    } else {
        return true;
    }
}

async function replayAndRebuildStateFromBlocks(cb) {
    rebuildUnfinished = 1
    let cmd = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep mongod` ]]; then `mongod --dbpath " + config.mongodbPath + " > mongo.log 2>&1 &`; fi"
    runCmd(cmd)

    cmd = "pgrep \"src/main\" | xargs --no-run-if-empty kill  -9"
    runCmd(cmd)
    await downloadBlocksFile();
    await getGenesisBlocks().then(()=>{
        cmd = "cd /avalon"
        cmd += " && sleep 2 && "
        if (parseInt(process.env.REBUILD_NO_VALIDATE) == 1)
            cmd += "REBUILD_NO_VALIDATE=1 "
        if (parseInt(process.env.REBUILD_NO_VERIFY) == 1)
            cmd += "REBUILD_NO_VERIFY=1 "
        cmd += "REBUILD_STATE=1 " + config.scriptPath + " >> " + config.logPath + " 2>&1"
        logr.info("Rebuilding state from blocks commands = ", cmd)
        runCmd(cmd)
        if (typeof cb == 'function') {
            cb()
        }
    })
}

async function replayFromAvalonBackup(cb) {
    await replayAndRebuildStateFromBlocks(cb);
    return;
    //
    // I guess DB snapshots aren't available anymore
    // The following code isn't executed.
    //
    cmd = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep mongod` ]]; then `mongod --dbpath " + config.mongodbPath + " > mongo.log 2>&1 &`; fi"
    runCmd(cmd)

    cmd = "pgrep \"src/main\" | xargs --no-run-if-empty kill  -9"
    runCmd(cmd)

    var backupUrl = config.backupUrl
    cmd = "cd /avalon"
    cmd += " && "
    cmd += "if [[ ! -d \"/avalon/dump\" ]]; then `mkdir /avalon/dump`; else `rm -rf /avalon/dump/*`; fi"
    cmd += " && "
    cmd += "cd /avalon/dump"
    cmd += " && "
    downloadCmd = "wget -q --show-progress --progress=bar:force " + backupUrl + " >> " + config.replayLogPath + " 2>&1"
    cmd += "if [[ ! -f $(TZ=GMT date +'%d%h%Y_%H').tar.gz ]]; then `" + downloadCmd + "`; fi" +  " && " + "tar xfvz ./*" + " >> " +  config.replayLogPath
    cmd += " && "
    cmd += "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep mongorestore` ]]; then `mongorestore -d " + db_name + " ./ >> " + config.replayLogPath + " 2>&1`; fi"
    cmd += " && "
    cmd += "cd /avalon"
    cmd += " && "
    cmd += "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep src/main` ]]; then `" + config.scriptPath + " >> " + config.logPath + " 2>1&" + "`; fi"

    logr.info("Replay from database snapshot commands = ", cmd)
    runCmd(cmd)
    cb()
}

async function checkHeightAndRun() {
    let url = getUrl()
    await axios.get(url + '/count').then(async (bHeight) => {
        curbHeight = bHeight.data.count

        let dt = getCurTime()
        logr.debug("\n")
        logr.debug("Current Time = ", dt)
        logr.debug("--------------------------------------------------")

        logr.debug('Previous block height = ', prevbHeight)
        logr.debug('Current block height  = ', curbHeight)

        if(createNet) {
            if (! checkBlocksFlow(15000)) {
                var mineStartCmd = "curl http://localhost:3001/mineBlock"
                runCmd(mineStartCmd)
            }
        } else if (prevbHeight == curbHeight) {
            //runCmd(runAvalonScriptCmd)
            if (replayState) {
                logr.info("Replaying from database")
            } else if (rebuildState) {
                if (!fs.existsSync(genesisFilePath)) {
                    await getGenesisBlocks()
                }
                if (! fs.existsSync('/data/avalon/blocks/blocks.bson')) {
                    await downloadBlocksFile();
                }
                logr.info("Rebuilding state from blocks")
                    mongo.init(()=> {
                        logr.info("Dropping avalon mongo db (replayState from database snapshot)")
                        mongo.dropDatabase(async ()=>{
                            await replayAndRebuildStateFromBlocks()
                        })
                    })
            } else {
                sameHeightCount++
                if (replayCount == replayCountMax) {
                    logr.info('Replay count max reached. Rebuilding block state.')
                    /*
                    mongo.init(function() {
                        logr.info("Dropping avalon mongo db (replayState from database snapshot)")
                        mongo.dropDatabase(function(){
                        })
                    })
                    */

                } else if (sameHeightCount == sameHeightThreshold && replayState == 0) {
                    sameHeightCount = 0
                    logr.info('Same block height threshold reached. Replaying from database.')
                    if (curbHeight == 0 || tryRestartForSameHeight == restartThreshold) {
                        tryRestartForSameHeight = 0
                        mongo.init(function() {
                            logr.info("Dropping avalon mongo db (replayState from database snapshot)")
                            mongo.dropDatabase(async function(){
                                replayState = 1
                                await replayAndRebuildStateFromBlocks(function(replayCount, replayState) {
                                    replayCount++
                                    replayState = 0
                                })
                            })
                        })
                    } else {
                        // kill main and restart
                        cmd = "pgrep \"src/main\" | xargs --no-run-if-empty kill  -9"
                        runCmd(cmd)

                        logr.info("Restarting avalon with new net")
                        runAvalonScriptCmd = config.scriptPath + " >> " + config.logPath + " 2>&1"
                        runCmd(runAvalonScriptCmd)
                        tryRestartForSameHeight++
                    }
                }
            }
        } else {
            // reset all variables
            sameHeightCount = 0
            replayCount = 0
            replayState = 0
            rebuildState = 0
            replayCheck = 0
        }
        prevbHeight = curbHeight
    }).catch(async () => {
        if(createNet) {
            mongo.init(function() {
                logr.info("Creating net")
                logr.info("Dropping avalon mongo db (creating new net)")
                mongo.dropDatabase(function(){
                    logr.info("Removing genesis.zip")
                    const removeGenesisCmd = "if [[ -d \"/avalon/genesis/genesis.zip\" ]]; then rm -rf /avalon/genesis; fi"
                    runCmd(removeGenesisCmd)

                    logr.info("Restarting avalon with new net")
                    const runAvalonScriptCmd = config.scriptPath + " >> " + config.logPath + " 2>&1"
                    runCmd(runAvalonScriptCmd)
                });
            })
        } else {
            if (replayState == 1) {
                logr.info("Replaying from database dump.. 2nd case")
                replayCheck++
                if (replayCheck == 5000) {
                    checkRestartCmd = ""
                    restartMongoDB = "if [[ ! $(ps aux | grep -v grep | grep -v defunct | grep 'mongod --dbpath') ]]; then `mongod --dbpath " + config.mongodbPath + " > mongo.log 2>&1 &`; fi && sleep 20"
                    restartAvalon = "if [[ ! $(ps aux | grep -v grep | grep -v defunct | grep src/main) ]]; then `" + config.scriptPath + " >> " + config.logPath + " 2>1&" + "`; fi"

                    checkRestartCmd =  restartMongoDB + " && "
                    checkRestartCmd += "echo '"+mongo.getHeadBlock()+"' > tmp.out 2>&1 && a=$(cat tmp.out) && sleep 5 && echo '" + mongo.getHeadBlock() + "'> tmp2.out 2>&1 && b=$(cat tmp2.out) && sleep 30 && if [ $a == $b ]; then ` "+ restartAvalon + " `; fi"
                    logr.info("Check restart command = " + checkRestartCmd)
                    runCmd(checkRestartCmd)
                    replayState = 0
                }
            } else if(rebuildState == 1) {
                rebuildState = 0
                logr.info("Rebuilding from blocks")
                await replayAndRebuildStateFromBlocks()
            } else if(process.env.REBUILD_STATE || process.env.REPLAY_STATE) {
                logr.info("Replay/Rebuild didn't start yet or finished.")
            }
        }
        await downloadBlocksFile();
        if (rebuildState == 0 && replayState == 0 && ! rebuildUnfinished && disableRestartScript == 0) {
            restartMongoDB = "if [[ ! $(ps aux | grep -v grep | grep -v defunct | grep 'mongod --dbpath') ]]; then mongod --dbpath " + config.mongodbPath + " >> /avalon/log/mongo.log 2>&1; fi"
            restartAvalon = "if [[ ! $(ps aux | grep -v grep | grep -v defunct | grep src/main) ]]; then `" + config.scriptPath + " >> " + config.logPath + " 2>1&" + "`; fi;"

            runCmd(restartMongoDB)
            if(!checkBlocksFlow()) {
                logr.warn("Restarting as we are at same block height as 30 seconds ago!")
                runCmd(restartAvalon)
            }
        }
    })
}


let restartMongoDB = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep 'mongod --dbpath'` ]]; then `mongod --dbpath " + config.mongodbPath + " &`; sleep 15; fi"
let restartAvalon = "if [[ ! `ps aux | grep -v grep | grep -v defunct | grep src/main` ]]; then `echo \" Restarting avalon\" >> " + config.logPath + " `; `" + config.scriptPath + " >> " + config.logPath + " 2>1&" + "`; fi"
// running first time
if (! fs.existsSync('/data/avalon/blocks/blocks.bson')) {
    await downloadBlocksFile();
    if (shouldGetGenesisBlocks) {
        await getGenesisBlocks().then(async ()=>{
            runCmd(restartMongoDB)
            if(rebuildState == 0) {
                await checkHeightAndRun()
            }
        })
    } else {
        runCmd(restartMongoDB)
        if(rebuildState == 0) {
            await checkHeightAndRun()
        }
        await checkHeightAndRun()
    }
}

if (shouldGetGenesisBlocks) {
    await getGenesisBlocks().then(async ()=>{
        runCmd(restartMongoDB)
        if(rebuildState == 0) {
            await checkHeightAndRun()
        }
    })
} else {
    runCmd(restartMongoDB)
    await checkHeightAndRun()
}
if (disableRestartScript === 0 || disableRestartScript === false || disableRestartScript.toString().toLowerCase() === "false") {
    cron.schedule("30 * * * * *", async () => {
        await checkHeightAndRun()
    });
} else if (createNet == 0) {
    logr.warn("Restart script disabled!");
    await runCmd(restartMongoDB);
    await runCmd(restartAvalon);
}
