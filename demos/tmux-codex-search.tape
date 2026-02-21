Output demos/codex-search-progress.gif
Set FontSize 18
Set Width 1320
Set Height 820
Set Padding 20
Set Framerate 30
Set Shell "bash"

Hide
Type "tmux kill-session -t codexdemo 2>/dev/null || true"
Enter
Sleep 300ms
Type "tmux new-session -d -s codexdemo 'clear; bash /home/mobrienv/projects/pi-codex-search/demos/run-codex-demo-only-extension.sh'"
Enter
Sleep 400ms
Type "tmux attach -t codexdemo"
Enter
Sleep 2s
Show
Sleep 55s
Type "exit"
Enter
Sleep 1s
Hide
Type "tmux kill-session -t codexdemo 2>/dev/null || true"
Enter
Sleep 300ms
