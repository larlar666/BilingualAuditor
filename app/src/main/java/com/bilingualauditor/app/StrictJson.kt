package com.bilingualauditor.app

/** Bounded RFC 8259 parser. Duplicate names, invalid surrogates and trailing data fail closed. */
internal object StrictJson {
    fun parse(text: String): Any? = Parser(text).run { value().also { whitespace(); require(position == text.length) } }
    fun quote(text: String): String = buildString {
        append('"'); text.forEach { c -> when (c) {
            '"' -> append("\\\""); '\\' -> append("\\\\"); '\n' -> append("\\n"); '\r' -> append("\\r"); '\t' -> append("\\t")
            else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
        } }; append('"')
    }
    fun wellFormed(s: String): Boolean {
        var i = 0
        while (i < s.length) {
            val c = s[i++]
            if (c.isHighSurrogate()) { if (i == s.length || !s[i++].isLowSurrogate()) return false }
            else if (c.isLowSurrogate()) return false
        }
        return true
    }
    private class Parser(val text: String) {
        var position = 0
        var depth = 0
        fun whitespace() { while (position < text.length && text[position] in " \r\n\t") position++ }
        fun value(): Any? {
            whitespace(); require(position < text.length && ++depth <= 32)
            val result = when (text[position]) {
                '"' -> string()
                '{' -> { position++; val map = linkedMapOf<String, Any?>(); whitespace()
                    if (!take('}')) { do { whitespace(); val key = string(); require(!map.containsKey(key)); whitespace(); require(take(':')); map[key] = value(); whitespace() } while (take(',')); require(take('}')) }; map }
                '[' -> { position++; val list = mutableListOf<Any?>(); whitespace(); if (!take(']')) { do { list += value(); whitespace() } while (take(',')); require(take(']')) }; list }
                't' -> literal("true", true); 'f' -> literal("false", false); 'n' -> literal("null", null)
                else -> { val match = Regex("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?").find(text, position); require(match != null && match.range.first == position); position += match.value.length; match.value.toBigDecimal() }
            }; depth--; return result
        }
        private fun literal(s: String, result: Any?): Any? { require(text.startsWith(s, position)); position += s.length; return result }
        private fun take(c: Char): Boolean = (position < text.length && text[position] == c).also { if (it) position++ }
        private fun string(): String {
            require(take('"')); val out = StringBuilder()
            while (position < text.length) {
                val c = text[position++]
                if (c == '"') return out.toString().also { require(wellFormed(it)) }
                require(c >= ' ')
                if (c != '\\') out.append(c) else { require(position < text.length); out.append(when (val escaped = text[position++]) {
                    '"', '\\', '/' -> escaped; 'b' -> '\b'; 'f' -> '\u000c'; 'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'
                    'u' -> { require(position + 4 <= text.length); val code = text.substring(position, position + 4); require(code.all { it in "0123456789abcdefABCDEF" }); position += 4; code.toInt(16).toChar() }
                    else -> error("Invalid JSON")
                }) }
            }; error("Invalid JSON")
        }
    }
}
