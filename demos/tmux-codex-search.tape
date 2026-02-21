Output demos/codex-search-progress.gif
Set FontSize 18
Set Width 1320
Set Height 820
Set Padding 20
Set Framerate 30
Set Shell "bash"

Hide
Type "cd /home/mobrienv/projects/pi-codex-search"
Enter
Sleep 800ms
Type "tmux kill-session -t codexdemo 2>/dev/null || true"
Enter
Sleep 500ms
Type "tmux new-session -d -s codexdemo"
Enter
Sleep 500ms
Type "tmux send-keys -t codexdemo 'bash demos/run-codex-demo.sh' C-m"
Enter
Sleep 700ms
Show
Type "tmux attach -t codexdemo"
Enter
Sleep 55s
Type "exit"
Enter
Sleep 1s
