on run
  set repoPath to "/Users/jo/Programs/Local_Gallery"
  tell application "Terminal"
    activate
    do script "cd " & quoted form of repoPath & " && npm start"
  end tell
end run
