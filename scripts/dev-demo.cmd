@echo off
setlocal EnableExtensions
chcp 65001 >nul
title DSH Tray 开发演示

set "ROOT=%~dp0.."
cd /d "%ROOT%"
if errorlevel 1 (
  echo [错误] 无法进入项目目录：%ROOT%
  goto :keep
)

echo ========================================
echo   DSH Tray 开发演示
echo   工作目录: %CD%
echo ========================================
echo.

set "NPM="
where.exe npm.cmd >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%I in ('where.exe npm.cmd 2^>nul') do (
    set "NPM=%%I"
    goto :npm_ready
  )
)

where.exe npm >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%I in ('where.exe npm 2^>nul') do (
    set "NPM=%%I"
    goto :npm_ready
  )
)

if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM=%ProgramFiles%\nodejs\npm.cmd" & goto :npm_ready
if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "NPM=%ProgramFiles(x86)%\nodejs\npm.cmd" & goto :npm_ready
if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "NPM=%LOCALAPPDATA%\Programs\nodejs\npm.cmd" & goto :npm_ready
if exist "%USERPROFILE%\scoop\apps\nodejs\current\npm.cmd" set "NPM=%USERPROFILE%\scoop\apps\nodejs\current\npm.cmd" & goto :npm_ready
if exist "%LOCALAPPDATA%\Volta\bin\npm.cmd" set "NPM=%LOCALAPPDATA%\Volta\bin\npm.cmd" & goto :npm_ready

where.exe node.exe >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%I in ('where.exe node.exe 2^>nul') do (
    if exist "%%~dpInpm.cmd" (
      set "NPM=%%~dpInpm.cmd"
      goto :npm_ready
    )
  )
)

echo [错误] 找不到 npm。请安装 Node.js，或把 npm 加入 PATH。
echo 已尝试 PATH、where.exe，以及 Program Files / scoop / Volta 等常见位置。
goto :keep

:npm_ready
echo 使用 npm: %NPM%
echo.

if not exist "node_modules\electron\package.json" (
  echo [提示] 项目依赖不完整（缺少 node_modules\electron）。
  echo 将仅在本目录执行 npm install，不会安装全局包。
  echo.
  call "%NPM%" install
  if errorlevel 1 (
    echo.
    echo [错误] npm install 失败。请检查网络后关闭窗口再试。
    goto :keep
  )
  echo.
)

if not exist "package.json" (
  echo [错误] 当前目录没有 package.json，已中止。
  goto :keep
)

echo 启动: npm start  （electron .）
echo 日志会显示在本窗口。托盘退出或关闭本窗口可结束演示。
echo ----------------------------------------
echo.

call "%NPM%" start
echo.
echo ----------------------------------------
echo npm start 已结束，退出码: %ERRORLEVEL%

:keep
echo.
echo 窗口保持打开，方便查看日志。关闭窗口即可。
endlocal
