$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path build | Out-Null
javac -d build src/AlexMindDesktop.java
jpackage --type exe --name ALEX-MIND --app-version 0.1.0 --input build --main-jar placeholder.jar --main-class AlexMindDesktop --win-shortcut --win-menu --dest dist
