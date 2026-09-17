-- Local Gallery launcher (macOS).
--
-- Opens the browser version in Chrome "app mode": its own window, no tabs, no
-- address bar, fullscreen. A website cannot open itself like that; the window
-- has to be launched this way, which is all this does.
--
-- It uses a Chrome profile of its own (~/Library/Application Support/Local
-- Gallery/Chrome) so the window starts as a fresh Chrome process -- the only
-- time Chrome honours --start-fullscreen -- and so the gallery's remembered
-- folder and permissions live apart from everyday browsing.
--
-- Built into an app by launcher/build-launcher.sh.

property galleryURL : "https://any-one-but.github.io/Local_Gallery/"
property chromeApp : "/Applications/Google Chrome.app"

on run
	try
		do shell script "test -d " & quoted form of chromeApp
	on error
		display dialog "Local Gallery needs Google Chrome, which isn't installed." buttons {"OK"} default button "OK" with icon caution
		return
	end try
	set profileDir to (POSIX path of (path to application support folder from user domain)) & "Local Gallery/Chrome"
	do shell script "mkdir -p " & quoted form of profileDir
	do shell script "open -na " & quoted form of chromeApp & " --args" & ¬
		" --user-data-dir=" & quoted form of profileDir & ¬
		" --app=" & quoted form of galleryURL & ¬
		" --start-fullscreen --no-first-run --no-default-browser-check"
end run
