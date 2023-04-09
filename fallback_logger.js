/**
 * @description Fallback logger
 */
export class FallbackLogger {
	constructor(name) {
		this.name = name
	}

	log(message, level) {
		console.log(`${this.name}.${level}: ${message}`)
	}

	debug(message) {
		return this.log(message, 0)
	}

	info(message) {
		return this.log(message, 1)
	}

	warn(message) {
		return this.log(message, 2)
	}

	error(message) {
		return this.log(message, 3)
	}
}

export default FallbackLogger