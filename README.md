# AWS Console – Blue Dark Mode

A small Chrome extension that brings back the old blue dark mode in the AWS
Console, because the new near-black one isn't it.

## Why the console turned black

The console is built on Cloudscape design tokens. AWS added a new theme
(`body.awsui-one-theme`) that remaps the dark neutral palette:

| Token        | Old (blue) | New (one-theme) |
|--------------|-----------|-----------------|
| neutral-950  | `#0f141a` | `#161512` |
| neutral-850  | `#161d26` | `#201e1b` |
| neutral-800  | `#1b232d` | `#262420` |
| neutral-750  | `#232b37` | `#2f2d28` |
| neutral-1000 | `#06080a` | `#100f0d` |

The old theme still ships in the same CSS, just switched off.

## How it works

Token names are hashed per service bundle (e.g. `--color-neutral-950-n1cpfy`),
so nothing is hard-coded. At runtime `content.js`:

1. **Older bundles:** finds rules guarded by
   `.awsui-visual-refresh:not(.awsui-one-theme)` and re-targets them at
   `.awsui-one-theme`.
2. **Newer bundles:** for each `.awsui-one-theme …` color override, finds the
   matching base rule and re-applies the base value.

It re-emits only `--color-*` tokens with `!important`, so layout, spacing and
fonts stay as AWS ships them. The extension does nothing in light mode, and it
rescans when a service lazy-loads new stylesheets.

## Install (Chrome / Edge / Brave / Arc)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Reload the AWS console.

The toolbar popup turns it on or off.

## If AWS changes it again

If AWS deletes the old theme rules from their CSS, there is nothing left for
the extension to restore. In that case, override the neutral palette directly
with the old values from the table above.
