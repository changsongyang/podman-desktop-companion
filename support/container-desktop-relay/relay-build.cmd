@echo off

echo "Building relay inside default WSL distribution"
wsl.exe --exec /bin/bash -i -l -c "./relay-build.sh"
