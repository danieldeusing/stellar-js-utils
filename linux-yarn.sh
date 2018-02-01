#!/bin/bash
mkdir tmp && cd tmp

curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list

cd .. && rm -R tmp

sudo apt-get update && sudo apt-get install yarn
