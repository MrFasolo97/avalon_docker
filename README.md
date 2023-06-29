# Be an avalon leader in minutes.
# You will be an observer node by default.

# Only top 15(may expand in tiers in future) elected nodes can mine dtube blocks on avalon chain, account @dtube excluded.
# Check Block explorer for current stats: 
      Run by leader fasolo97: https://explorer.dtube.fso.ovh/#/
      Run and created by leader techcoderx: https://avalonblocks.com/#/


Step 1.
  1-A. Install docker
    https://docs.docker.com/get-docker/

  1-B. Install docker compose
    https://docs.docker.com/compose/install/

Step 2.
  Build the avalon image using 
  docker-compose build

Step 3.
  Create avalon, mongodb, logs directory under your home directory. The total chain and related db stays outside of the docker container, in this avalon directory.
`
  mkdir -p ~/avalon/mongodb &&
  mkdir ~/avalon/blocks &&
  mkdir ~/avalon/logs
`

Step 4.
  Update .env file to set ports and other environment variables.

Step 5.
  Run the avalon container and be a observer leader.
  `docker compose up -d`
  Check logs:
  `docker compose logs -f`
## How to run a miner node?
  Set the leader account and leader keys on .env file as described above.
  Then if the node is already running restart it with:

`docker compose down && docker compose up -d`

Check the logs to see if your leader data is detected and correct.

Tip appreciated! Maintained by `@fasolo97`, made by `@brishtieveja0595`.

