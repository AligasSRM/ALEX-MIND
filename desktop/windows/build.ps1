$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path build,dist | Out-Null
javac -d build src/AlexMindDesktop.java
jar --create --file build/ALEX-MIND.jar --main-class AlexMindDesktop -C build AlexMindDesktop.class
jpackage --type exe --name ALEX-MIND --app-version 0.1.0 --input build --main-jar ALEX-MIND.jar --main-class AlexMindDesktop --win-shortcut --win-menu --dest dist
