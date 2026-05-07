# <img src="matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge

[![npm version](https://img.shields.io/npm/v/matterbridge-hass.svg)](https://www.npmjs.com/package/matterbridge-hass)
[![npm downloads](https://img.shields.io/npm/dt/matterbridge-hass.svg)](https://www.npmjs.com/package/matterbridge-hass)
[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge?label=docker%20version&sort=semver)](https://hub.docker.com/r/luligu/matterbridge)
[![Docker Pulls](https://img.shields.io/docker/pulls/luligu/matterbridge.svg)](https://hub.docker.com/r/luligu/matterbridge)
![Node.js CI](https://github.com/Luligu/matterbridge-hass/actions/workflows/build-matterbridge-plugin.yml/badge.svg)
![Coverage](https://img.shields.io/badge/Jest%20coverage-100%25-brightgreen)

[![power by](https://img.shields.io/badge/powered%20by-matterbridge-blue)](https://www.npmjs.com/package/matterbridge)
[![power by](https://img.shields.io/badge/powered%20by-node--ansi--logger-blue)](https://www.npmjs.com/package/node-ansi-logger)
[![power by](https://img.shields.io/badge/powered%20by-node--persist--manager-blue)](https://www.npmjs.com/package/node-persist-manager)

---

This plugin allows you to 

Features:


If you like this project and find it useful, please consider giving it a star on GitHub at https://github.com/Luligu/matterbridge-hass and sponsoring it.

<a href="https://www.buymeacoffee.com/luligugithub">
  <img src="bmc-button.svg" alt="Buy me a coffee" width="120">
</a>

## Prerequisites

### Matterbridge

Follow these steps to install or update Matterbridge if it is not already installed and up to date:

```
npm install -g matterbridge --omit=dev
```

on Linux od macOS you may need the necessary permissions:

```
sudo npm install -g matterbridge --omit=dev
```

See the complete guidelines on [Matterbridge](https://github.com/Luligu/matterbridge/blob/main/README.md) for more information.

## How to install the plugin

### With the frontend (preferred method)

Just open the frontend, select the matterbridge plugin and click on install. If you are using Matterbridge with Docker (I suggest you do it), all plugins are already loaded in the container so you just need to select and add it.

### Without the frontend

On windows:

```
cd $HOME\Matterbridge
npm install -g matterbridge-hass --omit=dev
matterbridge -add matterbridge-hass
```

On linux or macOS:

```
cd ~/Matterbridge
sudo npm install -g matterbridge-hass --omit=dev
matterbridge -add matterbridge-hass
```

Then start Matterbridge from a terminal

```
matterbridge
```

## How to use it

### whiteList

If the whiteList is defined only the devices and the individual entities included are exposed to Matter. Use the device/entity name or the device/entity id.

### blackList

If the blackList is defined the devices and the individual entities included will not be exposed to Matter. Use the device/entity name or the device/entity id.

### deviceEntityBlackList

List of entities not to be exposed for a single device. Enter in the first field the name of the device and in the second field add all the entity names you want to exclude for that device.

### debug

Should be enabled only if you want to debug some issue using the log.
