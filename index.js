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
import showdown from 'showdown'
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
const FILE_PLAYLISTS = 'playlists'
const FILE_SUMMARY = 'summary'

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
			// artists, songs
			'user-top-read',
			// playlists created and followed
			'playlist-read-private'
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
					logger.warn(
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

function get_top_playlists(client) {
	// 0-50
	const limit = 50
	
	logger.info('get created and followed playlists for current user')
	return client.getUserPlaylists({
		limit: limit,
		offset: 0
	})
	.then((data) => {
		const playlists = data.body
		
		// store songs per playlist id in this attr
		playlists['songs'] = {}
		
		let p_playlist_songs = []
		for (let playlist of playlists['items']) {
			p_playlist_songs.push(get_playlist_songs(client, playlist['id']))
		}
		
		return Promise.allSettled(p_playlist_songs)
		.then((playlist_songs_list) => {
			// add songs list as attribute to each playlist
			for (let playlist_songs of playlist_songs_list) {
				if (playlist_songs.status == 'fulfilled') {
					let songs = playlist_songs.value['items']
					let id = playlist_songs.value['playlist_id']
					
					playlists['songs'][id] = songs
					logger.info(`added ${songs.length} songs to playlist ${id}`)
				}
				else {
					logger.warn(`unable to load songs for playlist: ${playlist_songs.reason}`)
				}
			}
			
			return playlists
		})
	})
}

function get_playlist_songs(client, playlist_id) {
	// 0-50
	const limit = 50
	
	logger.info(`get up to ${50} songs in playlist ${playlist_id}`)
	return client.getPlaylistTracks(playlist_id, {
		limit: limit,
		offset: 0,
		fields: 'items(track(name,external_urls,id,popularity))'
	})
	.then((data) => {
		data.body['playlist_id'] = playlist_id
		return Promise.resolve(data.body)
	})
}

function save(data, user_id, filename, filetype='json') {
	let dir = `${PATH_DIR_DATA}/${user_id}`
	let file = `${dir}/${filename}.${filetype}`
	
	return fs.mkdir(dir, {
		recursive: true
	})
	.then(() => {
		let content = data
		if (filetype == 'json') {
			content = JSON.stringify(data, undefined, '  ')
		}
		
		return fs.writeFile(file, content, {
			encoding: 'utf8'
		})
	})
	.then(() => {
		return Promise.resolve(file)
	})
}

function summarize(profile, artists, songs, playlists) {
	return new Promise((res) => {
		logger.info('parse profile image')
		let profile_image_url = 
			(profile['images'] != undefined && profile['images'].length > 0)
			? profile['images'][0]['url']
			: undefined
	
		let line_profile_image = 
			profile_image_url !== undefined
			? `![${profile['id']} profile image](${profile_image_url})`
			: ''
	
		logger.info('summarize top artists')
		let lines_artists = []
		for (let artist of artists['items']) {
			lines_artists.push(
				` - [${artist['name']}](${artist['external_urls']['spotify']})`
			)
		}
	
		logger.info('summarize top songs')
		let lines_songs = []
		for (let song of songs['items']) {
			lines_songs.push(
				`- [${song['name']}](${song['external_urls']['spotify']}) \`popularity=${song['popularity']}\``
			)
		}
		
		logger.info('summarize top playlists')
		let lines_playlists = []
		for (let playlist of playlists['items']) {
			lines_playlists.push(
				`- [${playlist['name']}](${playlist['external_urls']['spotify']}) ` + 
				`by [${playlist['owner']['display_name']}](${playlist['owner']['external_urls']['spotify']}) ` + 
				`\`song-count=${playlist['tracks']['total']} public=${playlist['public']}\` ` +
				`_${playlist['description']}_`
			)
			
			if (playlists['songs'].hasOwnProperty(playlist['id'])) {
				let song_indent = '    '
				for (let song of playlists['songs'][playlist['id']]) {
					if (song.hasOwnProperty('track')) {
						try {
							const track = song['track']
							lines_playlists.push(
								`${song_indent}- [${track['name']}](${track['external_urls']['spotify']}) ` + 
								`\`popularity=${track['popularity']}\``
							)
						}
						catch (err) {
							logger.info(`omit song from playlist: ${err.stack}`)
						}
					}
					else {
						logger.info(`omit entry that is not a song/track from playlist summary: ${song}`)
					}
				}
			}
		}
		
		res(
			[
				`# Spotify user summary: ${profile['id']}`,
				'',
			]
			.concat([
				`Last update: ${new Date().toString()}`,
				'',
				line_profile_image,
				'',
				'| key | value |',
				'| --- | ----- |',
				`| display name | ${profile['display_name']} |`,
				`| id | ${profile['id']} |`,
				`| followers count | ${profile['followers']['total']} |`,
				''	
			])
			.concat([
				`## Top ${artists['items'].length} Artists`,
				''
			])
			.concat(lines_artists)
			.concat([
				'',
				`## Top ${songs['items'].length} Songs`,
				''
			])
			.concat(lines_songs)
			.concat([
				'',
				`## Top ${playlists['items'].length} Playlists`,
				''
			])
			.concat(lines_playlists)
			.concat([
				'',
				'---',
				'',
				'Generated with [github.com/ogallagher/spotify-client](https://github.com/ogallagher/spotify-client).'
			])
			.join('\n')
		)
	})
}

function file_convert(origin, target, origin_filetype='md', target_filetype='html') {
	if (origin_filetype == 'md' && target_filetype == 'html') {
		// markdown-html converter
		const md_html_converter = new showdown.Converter({
			omitExtraWLInCodeBlocks: true,
			customizedHeaderId: true,
			ghCompatibleHeaderId: true,
			tables: true,
			tasklists: true,
			completeHTMLDocument: true
		})
		
		const origin_path = `${origin}.${origin_filetype}`
		const target_path = `${target}.${target_filetype}`
		
		return new Promise((res, rej) => {
			logger.info(`compiling ${origin} to html at ${target}`)
			
			// read from origin
			fs.readFile(origin_path, 'utf8')
			// convert content
			.then(
				(markdown) => {
					try {
						let html = md_html_converter.makeHtml(markdown)
						logger.info(`converted md to html. html length = ${html.length}`)
						return html
					}
					// convert failed
					catch (err) {
						rej(new Error(`html compilation failed: ${err}\nsource markdown:\n${markdown}`))
					}
				},
				// read failed
				(err) => {
					rej(new Error(`unable to parse origin file ${origin_path}: ${err}`))
				}
			)
			// export to target
			.then((html) => {
				// export to file
				return fs.writeFile(target_path, html)
			})
			// finish
			.then(
				() => {
					logger.info(`wrote to target file ${target_path}`)
					res(target_path)
				},
				(err) => {
					rej(new Error(`failed to write to target file ${target_path}`))
				}
			)
		})
	}
	else {
		return Promise.reject(new Error(`unable to convert from ${origin_filetype} to ${target_filetype}`))
	}
}

function main(client) {
	// get basic profile
	return get_user(client)
	
	// get listener signature
	.then(
		(profile) => {
			logger.info(JSON.stringify(profile, undefined, '  '))
			
			function fetch_listener_info() {
				return Promise.all([
					Promise.resolve(profile),
					get_top_artists(client),
					get_top_songs(client),
					get_top_playlists(client)
				])
			}
		
			// save profile data
			return save(profile, profile['id'], FILE_PROFILE)
			.catch((err) => { 
				logger.error(`failed to save profile to local: ${err}\n${err.stack}`) 
			})
			
			// get listener signature from local files if they exist
			.then(() => {
				return Promise.all([
					fs.readFile(`${PATH_DIR_DATA}/${profile['id']}/${FILE_ARTISTS}.json`),
					fs.readFile(`${PATH_DIR_DATA}/${profile['id']}/${FILE_SONGS}.json`),
					fs.readFile(`${PATH_DIR_DATA}/${profile['id']}/${FILE_PLAYLISTS}.json`)
				])
				.then(
					// local fetch passed; return contents
					(data_strings) => {
						try {
							let data = [
								profile
							]
							for (let data_string of data_strings) {
								try {
									data.push(JSON.parse(data_string))
								}
								catch (err) {
									throw new Error(`unable to parse file contents to json: ${data_string}`)
								}
							}
							
							return Promise.resolve(data)
						}
						catch (err) {
							// failed to parse listener info from local files; get from spotify
							logger.warn(err.stack)
							return fetch_listener_info()
						}
					},
					// failed to load listener signature from local; get from spotify
					(err) => {
						logger.warn(`failed to load artists and songs from local: ${err}\n${err.stack}`)
						return fetch_listener_info()
					}
				)
			})
		},
		(err) => {
			logger.error(`failed to get current user profile: ${err.stack}`)
			process.exit(1)
		}
	)
	
	// save listener info to files
	.then(
		([profile, artists, songs, playlists]) => {
			logger.debug(artists)
			let p_artists = save(artists, profile['id'], FILE_ARTISTS, 'json')
		
			logger.debug(songs)
			let p_songs = save(songs, profile['id'], FILE_SONGS, 'json')
			
			logger.debug(playlists)			
			let p_playlists = save(playlists, profile['id'], FILE_PLAYLISTS, 'json')
			
			let p_summary = summarize(profile, artists, songs, playlists)
			// save summary
			.then((summary) => {
				return save(summary, profile['id'], FILE_SUMMARY, 'md')
			})
			
			let p_summary_html = p_summary
			// convert summary to html
			.then((summary_path) => {
				let ext_idx = summary_path.lastIndexOf('.')
				let summary_filename = summary_path.substring(0, ext_idx)
				let summary_filetype = summary_path.substring(ext_idx+1)
				
				return file_convert(summary_filename, summary_filename, summary_filetype, 'html')
				// show summary html in browser
				.then((summary_html_path) => {
					web_browser_open(summary_html_path)
					return summary_html_path
				})
			})
			
			return Promise.all([p_artists, p_songs, p_playlists, p_summary, p_summary_html])
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
			logger.error('failed to save user signature to local files: ' + JSON.stringify(err, undefined, '  '))
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
