const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

// The app imports the Teams domain rules from ../shared, the same files the
// server uses, so Metro has to watch outside the project.
const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../shared')]

module.exports = config
