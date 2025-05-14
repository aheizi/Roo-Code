import { readFileWithEncoding } from "../readFileWithEncoding"
import * as fs from "fs/promises"
import * as chardet from "chardet"
import * as iconv from "iconv-lite"

jest.mock("fs/promises")
jest.mock("chardet")
jest.mock("iconv-lite")

const mockFs = fs as jest.Mocked<typeof fs>
const mockChardet = chardet as jest.Mocked<typeof chardet>
const mockIconv = iconv as jest.Mocked<typeof iconv>

describe("readFileWithEncoding", () => {
	afterEach(() => {
		jest.resetAllMocks()
	})

	it("returns UTF-8 text when detected", async () => {
		const utf8Text = "hello 你好"
		const buffer = Buffer.from(utf8Text, "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue("utf-8")
		const result = await readFileWithEncoding("test.txt")
		expect(result).toBe(utf8Text)
		expect(mockIconv.decode).not.toHaveBeenCalled()
	})

	it("returns GB18030 decoded text when detected", async () => {
		const gbBuffer = Buffer.from("你好世界", "utf8")
		mockFs.readFile.mockResolvedValue(gbBuffer)
		mockChardet.detect.mockReturnValue("gb18030")
		mockIconv.decode.mockImplementation((buf, enc) => {
			if (enc === "gb18030") return "你好世界"
			return buf.toString("utf8")
		})
		const result = await readFileWithEncoding("test.txt")
		expect(result).toBe("你好世界")
		expect(mockIconv.decode).toHaveBeenCalledWith(gbBuffer, "gb18030")
	})

	it("tries gb18030 first if chardet returns shift_jis and gb18030 contains CJK", async () => {
		const buffer = Buffer.from("Fake CJK", "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue("shift_jis")
		mockIconv.decode.mockImplementation((buf, enc) => {
			if (enc === "gb18030") return "包含中文"
			if (enc === "shift_jis") return "シフトジス"
			return buf.toString("utf8")
		})
		const result = await readFileWithEncoding("test.txt")
		expect(result).toBe("包含中文")
		expect(mockIconv.decode).toHaveBeenCalledWith(buffer, "gb18030")
	})

	it("falls back to shift_jis if gb18030 does not contain CJK", async () => {
		const buffer = Buffer.from("sjis", "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue("shift_jis")
		mockIconv.decode.mockImplementation((buf, enc) => {
			if (enc === "gb18030") return "sjis"
			if (enc === "shift_jis") return "シフトジス"
			return buf.toString("utf8")
		})
		const result = await readFileWithEncoding("test.txt")
		expect(result).toBe("シフトジス")
		expect(mockIconv.decode).toHaveBeenCalledWith(buffer, "shift_jis")
	})

	it("for non-text extension, prefers chardet result", async () => {
		const buffer = Buffer.from("binary content", "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue("gbk")
		mockIconv.decode.mockImplementation((buf, enc) => {
			if (enc === "gb18030") return "binary content"
			return buf.toString("utf8")
		})
		const result = await readFileWithEncoding("file.bin")
		expect(result).toBe("binary content")
		expect(mockIconv.decode).toHaveBeenCalledWith(buffer, "gb18030")
	})

	it("falls back to utf-8 if encoding is unknown", async () => {
		const buffer = Buffer.from("ascii only", "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue("unknown")
		const result = await readFileWithEncoding("test.txt")
		expect(result).toBe("ascii only")
	})

	it("falls back to utf-8 if chardet returns null", async () => {
		const buffer = Buffer.from("test", "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue(null as any)
		const result = await readFileWithEncoding("test.txt")
		expect(result).toBe("test")
	})

	it("supports multiple text extensions", async () => {
		const buffer = Buffer.from("log content", "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue("utf-8")
		const files = ["a.yml", "b.yaml", "c.csv", "d.log"]
		for (const file of files) {
			const result = await readFileWithEncoding(file)
			expect(result).toBe("log content")
		}
	})
	it("falls back to utf-8 if bestScore is not greater than 0.05", async () => {
		// Only ASCII, scoreText will return -1 (pure ASCII)
		const buffer = Buffer.from("just ascii", "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue("utf-8")
		// Simulate iconv.decode throws for all encodings except utf-8
		mockIconv.decode.mockImplementation(() => {
			throw new Error("decode error")
		})
		const result = await readFileWithEncoding("plain.txt")
		expect(result).toBe("just ascii")
	})

	it("skips encoding if iconv.decode throws", async () => {
		const buffer = Buffer.from("error", "utf8")
		mockFs.readFile.mockResolvedValue(buffer)
		mockChardet.detect.mockReturnValue("gbk")
		let callCount = 0
		mockIconv.decode.mockImplementation((buf, enc) => {
			callCount++
			if (enc === "gbk") throw new Error("decode error")
			return buf.toString("utf8")
		})
		const result = await readFileWithEncoding("test.txt")
		expect(result).toBe("error")
		expect(callCount).toBeGreaterThan(0)
	})
})
