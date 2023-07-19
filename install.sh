#!/bin/bash
distro=$(bash -c "lsb_release --id --short | tr '[:upper:]' '[:lower:]'")

if [[ ! $distro = @(ubuntu|debian) ]]; then
  echo "Distro $distro not supported!"
  if [[ $1 == -f ]]; then
    echo "Forcing script to run on an unsupported distro!"
  else
    echo "You can try anyway, forcing this script, with '-f' parameter."
    exit -1
  fi
fi

sudo apt update
sudo apt upgrade -yy
sudo apt install ca-certificates curl gnupg git -yy

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/$distro/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg


echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$distro \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update -yy
sudo apt install docker docker.io docker-compose-plugin git -yy

cd
mkdir -p ~/avalon/mongodb; mkdir ~/avalon/blocks; mkdir ~/avalon/logs
git clone https://github.com/MrFasolo97/avalon_docker
echo user $USER
sudo usermod -aG docker $USER
cd avalon_docker
ln -s Dockerfile.$(dpkg --print-architecture) Dockerfile
sudo docker compose build
sudo docker compose create avalon
sudo docker compose --compatibility up -d
