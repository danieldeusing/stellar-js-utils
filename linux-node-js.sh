#!/bin/bash

mkdir tmp && cd tmp

wget https://nodejs.org/dist/v8.9.4/node-v8.9.4-linux-x64.tar.xz
sudo tar -xf node-v8.9.4-linux-x64.tar.xz --directory /usr/local --strip-components 1

cd .. && rm -r tmp

sudo apt-get install libusb-1.0.0-dev
