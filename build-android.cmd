@echo off
setlocal
set "ROOT=%~dp0"
if not defined JAVA_HOME if exist "D:\Java17\jdk17.0.19_10\bin\java.exe" set "JAVA_HOME=D:\Java17\jdk17.0.19_10"
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo JDK 17 is required. Set JAVA_HOME and try again.
  pause
  exit /b 1
)
if not defined ANDROID_HOME if exist "%ROOT%android\.sdk\platforms\android-35" set "ANDROID_HOME=%ROOT%android\.sdk"
if not defined ANDROID_HOME (
  echo Android SDK Platform 35 is required. Set ANDROID_HOME and try again.
  pause
  exit /b 1
)
if exist "%ROOT%gradle-8.13\bin\gradle.bat" (
  set "GRADLE=%ROOT%gradle-8.13\bin\gradle.bat"
) else (
  set "GRADLE=gradle"
)
cd /d "%ROOT%android"
call "%GRADLE%" assembleDebug
if errorlevel 1 (
  echo APK build failed. Check the message above.
  pause
  exit /b 1
)
if not exist "%ROOT%dist" mkdir "%ROOT%dist"
copy /y "%ROOT%android\app\build\outputs\apk\debug\app-debug.apk" "%ROOT%dist\GoodNight-Android-debug.apk" >nul
if errorlevel 1 (
  echo APK was built but could not be copied to dist.
  pause
  exit /b 1
)
echo APK ready: %ROOT%dist\GoodNight-Android-debug.apk
pause
