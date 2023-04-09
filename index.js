/**
 * @description [Spotify](https://developer.spotify.com) API client cli app.
 */

import * as dotenv from 'dotenv'
import { URL, URLSearchParams } from 'node:url'
import express from 'express'
import bent from 'bent'
import * as uuid from 'uuid'
import web_browser_open from 'open'
import formurlencoded from 'form-urlencoded'
import * as fs from 'node:fs/promises'
let pino = undefined
let spotify = undefined
import { FallbackLogger } from './fallback_logger.js'

let logger = new FallbackLogger('fallback-logger')

const URL_BASE_SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com'
const URL_PATH_SPOTIFY_AUTH_REQUEST = '/authorize'
const URL_PATH_AUTH_RESULT = '/authresult'
const URL_PATH_SPOTIFY_TOKEN_REQUEST = '/api/token'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_OK_PUT = 201

// set using .env
let redirect_url = undefined

const PATH_DIR_DATA = './data'
const FILE_PROFILE = 'profile'
const FILE_ARTISTS = 'artists'
const FILE_SONGS = 'songs'

/* TODO use spotify sdk to handle auth */
function init_auth(client_id) {
	return new Promise(function (res, rej) {
		// launch server to handle auth response
		let server_app = express()
		let server = server_app.listen(process.env.SERVER_PORT, () => {
			logger.info(`local webserver deployed at localhost:${process.env.SERVER_PORT}`)
		})
		
		var token_out = uuid.v4()
		logger.debug(`spotify new token-out=${token_out}`)
		var scope = [
			'user-top-read'
		].join(' ')
		
		let auth_url = new URL(URL_PATH_SPOTIFY_AUTH_REQUEST, URL_BASE_SPOTIFY_ACCOUNTS)
		
		let auth_url_query = new URLSearchParams()
		auth_url_query.append('response_type', 'code')
		auth_url_query.append('client_id', client_id)
		auth_url_query.append('scope', scope)
		auth_url_query.append('state', token_out)
		auth_url_query.append('redirect_uri', redirect_url)
		
		auth_url.search = auth_url_query
		
		// open spotify login/auth page
		logger.info('opening spotify login page')
		web_browser_open(auth_url.toString())
		
		// handle auth result
		server_app.get(URL_PATH_AUTH_RESULT, function(request, result) {
			let query = request.query
			logger.info(`spotify auth result: ${JSON.stringify(query, undefined, '  ')}`)
			
			if (query.error != undefined) {
				result.send('login rejected; you can close the page now.')
				rej(new Error(`auth refused: ${query.error}`))
			}
			else {
				let token_req_code = query.code
				let token_echo = query.state
				
				// token request code granted does not technically to the request i sent
				if (token_echo != token_out) {
					logger.warning(
						`incoming echo (${token_echo}) ` +
						`did not match the original token-out value (${token_out}). ` +
						`accepting anyway`
					)
				}
				
				result.send('login complete; you can close the page now.')
				res(token_req_code)
			}
		})
		
		logger.info('spotify login pending')
	})
}

function token_auth(client_id, client_secret, token_code) {
	return new Promise(function (res, rej) {
		const bent_post = bent(
			// url base
			URL_BASE_SPOTIFY_ACCOUNTS,
			// http method
			'POST',
			// response format
			'json',
			// http status codes accepted
			HTTP_STATUS_OK, HTTP_STATUS_OK_PUT, 400
		)
		
		const req_body = {
			grant_type: 'authorization_code',
			code: token_code,
			redirect_uri: redirect_url
		}
		const client_id_secret = new Buffer.from(client_id + ':' + client_secret).toString('base64')
		logger.debug(`client id+secret = ${client_id_secret}`)
		const req_headers = {
			'Authorization': `Basic ${client_id_secret}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		}
		
		bent_post(	
			// url path
			URL_PATH_SPOTIFY_TOKEN_REQUEST,
			// body
			formurlencoded(req_body),
			// headers
			req_headers
		)
		.then((response) => {
			logger.debug(JSON.stringify(response, undefined, '  '))
			res(response.access_token, response.expires_in, response.refresh_token)
		})
		.catch((err) => {
			rej(new Error(`failed to fetch api token: status=${response_stream.status}`))
		})
	})
}

function init_api_client(settings, token) {
	// spotify-sdk syntax
	// let client = spotify.Client.instance
	// client.settings = settings
	// client.token = token
	
	// spotify-web-api-node syntax
	let client = new spotify.default(settings)
	client.setAccessToken(token)
	
	return client
}

function init() {
	return new Promise(function (res, rej) {
		dotenv.config()
		logger.debug(`loaded .env to process.env: spotify-client-id=${process.env.SPOTIFY_CLIENT_ID}`)
		
		redirect_url = `http://localhost:${process.env.SERVER_PORT}${URL_PATH_AUTH_RESULT}`
		
		if (pino !== undefined) {
			logger = pino().child({
				name: 'spotify-client'
			})
			logger.info('initialized pino logger')
		}
		
		let no_token_code = (process.env.SPOTIFY_TOKEN_CODE == undefined || process.env.SPOTIFY_TOKEN_CODE == '')
		let no_token = (process.env.SPOTIFY_TOKEN == undefined || process.env.SPOTIFY_TOKEN == '')
		
		function get_token_code() {
			if (no_token_code && no_token) {
				return init_auth(process.env.SPOTIFY_CLIENT_ID)
			}
			else {
				return Promise.resolve(process.env.SPOTIFY_TOKEN_CODE)
			}
		}
		
		get_token_code()
		.then((token_req_code) => {
			logger.info(`spotify api token request code = ${token_req_code}`)
			
			logger.info('requesting api token')
			if (no_token) {
				return token_auth(
					process.env.SPOTIFY_CLIENT_ID, 
					process.env.SPOTIFY_SECRET_ID, 
					token_req_code
				)
			}
			else {
				logger.info('api token loaded from .env')
				return Promise.resolve(process.env.SPOTIFY_TOKEN)
			}
		})
		.then((token, expiry_seconds, refresh_token) => {
			let client = init_api_client(
				{
					clientId: process.env.SPOTIFY_CLIENT_ID,
					secretId: process.env.SPOTIFY_SECRET_ID,
					clientSecret: process.env.SPOTIFY_SECRET_ID,
					redirect_uri: redirect_url,
					redirectUri: redirect_url
				},
				token
			)
			logger.info(`initialized spotify api client w token ${token.substring(0,30)}...`)
			res(client)
		})
		.catch(rej)
	})
}

function get_user(client, id) {
	if (id === undefined) {
		logger.info('get current user profile')
		return client.getMe()
		.then((data) => {
			return Promise.resolve(data.body)
		})
	}
	else {
		logger.info(`get ${id} user profile`)
		return client.getUser(id)
		.then((data) => {
			return Promise.resolve(data.body)
		})
	}
}

function get_top_artists(client) {
	// 0-50
	const limit = 50
	
	logger.info('get favorite artists for current user')
	return client.getMyTopArtists({
		time_range: 'medium_term',
		limit: limit
		// offset: 0
	})
	.then((data) => {
		return Promise.resolve(data.body)
	})
}

function get_top_songs(client) {
	// 0-50
	const limit = 50
	
	logger.info('get favorite songs for current user')
	return client.getMyTopTracks({
		time_range: 'medium_term',
		limit: limit
		// offset: 0
	})
	.then((data) => {
		return Promise.resolve(data.body)
	})
}

function save(data, user_id, filename) {
	let dir = `${PATH_DIR_DATA}/${user_id}`
	let file = `${dir}/${filename}.json`
	
	return fs.mkdir(dir, {
		recursive: true
	})
	.then(() => {
		return fs.writeFile(file, JSON.stringify(data, undefined, '  '), {
			encoding: 'utf8'
		})
	})
	.then(() => {
		return Promise.resolve(file)
	})
}

function main(client) {
	// get basic profile
	return get_user(client)
	
	// get artists and songs
	.then(
		(profile) => {
			logger.info(JSON.stringify(profile, undefined, '  '))
		
			// save profile data
			return save(profile, profile['id'], FILE_PROFILE)
			.catch((err) => { 
				logger.error(`failed to save profile to local: ${err}\n${err.stack}`) 
			})
			
			// get artists,songs from local files if they exist
			.then(() => {
				return Promise.all([
					fs.readFile(`${PATH_DIR_DATA}/${profile['id']}/${FILE_ARTISTS}.json`),
					fs.readFile(`${PATH_DIR_DATA}/${profile['id']}/${FILE_SONGS}.json`)
				])
				.then(
					// local fetch passed; return contents
					(data_strings) => {
						let data = [
							profile
						]
						for (let data_string of data_strings) {
							data.push(JSON.parse(data_string))
						}
		
						return Promise.resolve(data)
					},
					// failed to load artists,songs from local; get from spotify
					(err) => {
						logger.error(`failed to load artists and songs from local: ${err}\n${err.stack}`)

						return Promise.all([
							Promise.resolve(profile),
							get_top_artists(client),
							get_top_songs(client)
						])
					}
				)
			})
		},
		(err) => {
			logger.error(`failed to get current user profile: ${err.stack}`)
			process.exit(1)
		}
	)
	
	// save artists and songs
	.then(
		([profile, artists, songs]) => {
			logger.debug(artists)
			let p_artists = save(artists, profile['id'], FILE_ARTISTS)
		
			logger.debug(songs)
			let p_songs = save(songs, profile['id'], FILE_SONGS)
		
			return Promise.all([p_artists, p_songs])
		},
		(err) => {
			logger.error('failed to fetch user preferences: ' + JSON.stringify(err, undefined, '  '))
			logger.error(err.stack)
			process.exit(2)
		}
	)
	
	// confirm user listening data saved
	.then(
		(files) => {
			logger.info(`saved user listening data to local files:\n${files.join('\n')}`)
		},
		(err) => {
			logger.error('failed to save user preferences to local files: ' + JSON.stringify(err, undefined, '  '))
			logger.error(err.stack)
		}
	)
	
	// quit
	.then(() => {
		logger.info('end spotify client')
	
		// otherwise, local webserver runs indefinitely
		process.exit()
	})
}

// import spotify sdk
// initially tried this one, but as of 2023-04 it was throwing errors on import for my version of node
// import('spotify-sdk')
// http://thelinmichael.github.io/spotify-web-api-node
import('spotify-web-api-node')
.then(
	(spotify_sdk) => {
		spotify = spotify_sdk
	},
	(err) => {
		logger.error(`spotify-sdk import error: ${err.stack}`)
	}
)

// import pino
.then(() => {
	return import('pino')
})
.then(
	(pino_import) => {
		pino = pino_import.default
	},
	(err) => {
		logger.error(`pino import error: ${err.stack}`)
	}
)

// initialize api client
.then(init)
.then(
	(client) => {
		logger.info(`init passed`)
		main(client)
	},
	(err) => {
		logger.error(`init failed: ${err.stack}`)
		process.exit(1)
	}
)
