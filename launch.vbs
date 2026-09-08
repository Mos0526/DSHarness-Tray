Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
electron = root & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electron) Then
  WScript.Echo "找不到 Electron。请先在项目目录执行 npm install。"
  WScript.Quit 1
End If
sh.Run """" & electron & """ .", 1, False
