#!/usr/bin/env python3
"""Check the bundled Scholar identity, including embedded extensions."""
import plistlib
import sys
from pathlib import Path

app = Path(sys.argv[1])
apple_dir = Path(sys.argv[2])
identifier = "io.github.gkwfhv.readestscholar"


def read_plist(path: Path):
    with path.open("rb") as source:
        return plistlib.load(source)


main = read_plist(app / "Info.plist")
assert main["CFBundleIdentifier"] == identifier
assert main["CFBundleName"] == "Readest Scholar"
assert list(main["NSUbiquitousContainers"]) == [f"iCloud.{identifier}"]
assert main["NSUbiquitousContainers"][f"iCloud.{identifier}"]["NSUbiquitousContainerName"] == "Readest Scholar"
usage_keys = (
    "NSLocalNetworkUsageDescription", "NSFaceIDUsageDescription", "NSPhotoLibraryAddUsageDescription"
)
usage = {key: main.get(key) for key in usage_keys}
assert all("Readest Scholar" in value for value in usage.values() if value is not None) and all(usage.values()), usage
schemes = [scheme for item in main["CFBundleURLTypes"] for scheme in item["CFBundleURLSchemes"]]
assert schemes == ["readest-scholar"], schemes

for extension in ("ReadestWidget", "ShareExtension"):
    info = read_plist(app / "PlugIns" / f"{extension}.appex" / "Info.plist")
    assert info["CFBundleIdentifier"] == f"{identifier}.{extension}"
    assert info["CFBundleDisplayName"] == "Readest Scholar", (extension, info.get("CFBundleDisplayName"))
    assert info["CFBundleShortVersionString"] == main["CFBundleShortVersionString"], (extension, info.get("CFBundleShortVersionString"), main.get("CFBundleShortVersionString"))

entitlements = read_plist(apple_dir / "Readest_iOS" / "Readest_iOS.entitlements")
assert "com.apple.developer.associated-domains" not in entitlements
assert entitlements["com.apple.security.application-groups"] == [f"group.{identifier}"]
assert entitlements["com.apple.developer.icloud-container-identifiers"] == [f"iCloud.{identifier}"]
share = (apple_dir / "ShareExtension" / "ShareViewController.swift").read_text()
widget = (apple_dir / "ReadestWidget" / "ReadingWidgetViews.swift").read_text()
assert 'scheme: "readest-scholar"' in share and 'scheme: "readest"' not in share
assert 'readest-scholar://book/' in widget and 'readest://book/' not in widget
print("Scholar iOS app, extensions, URL scheme, and entitlements match the release identity")
