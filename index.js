/**
 * @description [Spotify](https://developer.spotify.com) API client cli app.
 */

import * as dotenv from 'dotenv'
import spotify_sdk from 'spotify-sdk'
const { Client } = spotify_sdk
import pino from 'pino'

const logger = new function() {
	this.name = 'fallback-logger'
}
logger.prototype.log = new function(message) {
	console.log(`${this.name}: ${message}`)
}
logger.prototype.debug = logger.prototype.log
logger.prototype.info = logger.prototype.log
logger.prototype.warning = logger.prototype.log
logger.prototype.error = logger.prototype.log

function init() {
	return new Promise(function (res,rej) {
		dotenv.config()
		logger.log(`loaded .env to process.env: spotify-client-id=${process.env.SPOTIFY_CLIENT_ID}`)
		
		logger = pino().child({
			name: 'spotify-client'
		})
		logger.info('initialized pino logger')
		
		let client = Client.instance
		client.settings = {
			clientId: process.env.SPOTIFY_CLIENT_ID,
			secretId: process.env.SPOTIFY_SECRET_ID
		}
		logger.info('initialized spotify api client')
		
		res(client)
	})	
}

function main() {
	init()
	.then((client) => {
		logger.info('init passed')
	})
	.catch((err) => {
		logger.error(`init failed: ${err}`)
	})
}

main()
