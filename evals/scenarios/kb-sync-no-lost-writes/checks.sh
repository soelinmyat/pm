pre() {
  file-exists kb/pm/insights/checkout-drop-off.md
  file-contains kb/pm/insights/checkout-drop-off.md "LOCAL-UNCOMMITTED-EDIT-keep-me"
}

post() {
  file-contains kb/pm/insights/checkout-drop-off.md "USER-AUTHORED-LINE-keep-me"
  file-contains kb/pm/insights/checkout-drop-off.md "LOCAL-UNCOMMITTED-EDIT-keep-me"
  command-succeeds "ls kb/pm/insights | grep -v checkout-drop-off | grep -q ."
}
