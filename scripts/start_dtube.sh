#!/bin/bash
echo "Following are the environment variables"
env
echo "Starting the mongodb database"
mongod --dbpath /var/lib/mongodb > mongodb.log &
sleep 2
echo "Cleaning log folder..."
rm /avalon/log/*
touch /avalon/log/avalon.log
echo "Running dtube node"
echo
node restartMining.mjs &
secs=5
msg=" ..."
while [ $secs -gt 0 ]
do
    printf "\r\033[KStarting in %.d seconds $msg" $((secs--))
    sleep 1
done
tail -f log/avalon.log
