import * as fs from "fs/promises"
import * as chardet from "chardet"
import * as iconv from "iconv-lite"

/**
 * Auto-detect file encoding and return UTF-8 string
 * Supports UTF-8/GBK/GB18030/shift_jis/ascii, with multi-encoding attempts and Chinese heuristic detection
 * @param filePath File path
 */
const alwaysTextExtensions = ["txt", "md", "js", "ts", "json", "html", "css", "xml", "csv", "log", "yaml", "yml"]
const candidateEncodings = ["utf-8", "gb18030", "gbk", "gb2312", "shift_jis"]

function scoreText(text: string): number {
	// Scoring: Chinese characters + common punctuation + full-width characters ratio
	const total = text.length
	if (total === 0) return 0
	const zh = (text.match(/[\u4e00-\u9fa5]/g) || []).length
	const punct = (text.match(/[\u3000-\u303F\uff00-\uffef]/g) || []).length
	const ascii = (text.match(/[\x00-\x7f]/g) || []).length
	// Higher score for Chinese + full-width punctuation, minus if pure ASCII
	return (zh * 2 + punct) / total - (ascii === total ? 1 : 0)
}

export async function readFileWithEncoding(filePath: string): Promise<string> {
	const buffer = await fs.readFile(filePath)
	const ext = filePath.split(".").pop()?.toLowerCase() || ""
	// 1. chardet detection
	let chardetEnc = (chardet.detect(buffer) || "utf-8").toString().toLowerCase()
	// 2. Build candidate encoding list
	const encodings = new Set<string>()
	encodings.add("utf-8")
	encodings.add("gb18030")
	if (chardetEnc && !encodings.has(chardetEnc)) encodings.add(chardetEnc)
	if (candidateEncodings.includes(chardetEnc)) encodings.add(chardetEnc)
	// 3. For common text types, try multiple encodings first
	if (alwaysTextExtensions.includes(ext)) {
		let bestScore = -Infinity
		let bestText = ""
		encodings.forEach((enc) => {
			let text: string
			try {
				if (enc === "utf-8" || enc === "utf8") {
					text = buffer.toString("utf8")
				} else {
					text = iconv.decode(buffer, enc)
				}
			} catch {
				return
			}
			const score = scoreText(text)
			if (score > bestScore) {
				bestScore = score
				bestText = text
			}
		})
		// If score above threshold, return best decoded text
		if (bestScore > 0.05) return bestText
		// Fallback to utf-8
		return buffer.toString("utf8")
	}
	// 4. For other types, prefer chardet result
	if (["gbk", "gb2312", "gb18030"].includes(chardetEnc)) {
		return iconv.decode(buffer, "gb18030")
	}
	if (chardetEnc === "shift_jis") {
		// Handle shift_jis misdetection, try gb18030
		const gbText = iconv.decode(buffer, "gb18030")
		if (/[\u4e00-\u9fa5]/.test(gbText)) return gbText
		return iconv.decode(buffer, "shift_jis")
	}
	// fallback
	return buffer.toString("utf8")
}
