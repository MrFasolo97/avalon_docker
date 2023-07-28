#!/bin/bash

if [[ $1 == "start" ]]; then
  docker compose up -d
fi


if [[ $1 == "stop" ]]; then
  docker compose down
fi


if [[ $1 == "rebuild" ]]; then
  docker compose down && REBUILD_STATE=1 docker compose up -d
fi


if [[ $1 == "logs" ]]; then
  docker compose logs -f
fi
