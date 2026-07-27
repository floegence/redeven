package gitruntime

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"unicode/utf16"
	"unicode/utf8"
)

const maxRetainedRequestBytes = RequestReservation
const maxRetainedResponseBytes = 8 << 20

type jsonPreflight struct {
	data        []byte
	pos         int
	tokens      int
	records     int
	stringBytes int
}

func validateRawJSON(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	if len(data) > MaxRawRequestBytes || !utf8.Valid(data) {
		return ErrRequestBudget
	}
	p := jsonPreflight{data: data}
	p.skipSpace()
	if err := p.value(1); err != nil {
		return ErrRequestBudget
	}
	p.skipSpace()
	if p.pos != len(data) {
		return ErrRequestBudget
	}
	return nil
}

func (p *jsonPreflight) value(depth int) error {
	if depth > MaxJSONDepth || p.pos >= len(p.data) {
		return ErrRequestBudget
	}
	p.tokens++
	if p.tokens > MaxJSONTokens {
		return ErrRequestBudget
	}
	switch p.data[p.pos] {
	case '{':
		return p.object(depth)
	case '[':
		return p.array(depth)
	case '"':
		_, err := p.string()
		return err
	case 't':
		return p.literal("true")
	case 'f':
		return p.literal("false")
	case 'n':
		return p.literal("null")
	default:
		return p.number()
	}
}

func (p *jsonPreflight) object(depth int) error {
	p.pos++
	p.skipSpace()
	if p.consume('}') {
		return nil
	}
	for {
		if p.pos >= len(p.data) || p.data[p.pos] != '"' {
			return ErrRequestBudget
		}
		p.tokens++
		if p.tokens > MaxJSONTokens {
			return ErrRequestBudget
		}
		if _, err := p.string(); err != nil {
			return err
		}
		p.skipSpace()
		if !p.consume(':') {
			return ErrRequestBudget
		}
		p.skipSpace()
		if err := p.value(depth + 1); err != nil {
			return err
		}
		p.records++
		if p.records > MaxJSONRecords {
			return ErrRequestBudget
		}
		p.skipSpace()
		if p.consume('}') {
			return nil
		}
		if !p.consume(',') {
			return ErrRequestBudget
		}
		p.skipSpace()
	}
}

func (p *jsonPreflight) array(depth int) error {
	p.pos++
	p.skipSpace()
	if p.consume(']') {
		return nil
	}
	for {
		if err := p.value(depth + 1); err != nil {
			return err
		}
		p.records++
		if p.records > MaxJSONRecords {
			return ErrRequestBudget
		}
		p.skipSpace()
		if p.consume(']') {
			return nil
		}
		if !p.consume(',') {
			return ErrRequestBudget
		}
		p.skipSpace()
	}
}

func (p *jsonPreflight) string() (int, error) {
	if !p.consume('"') {
		return 0, ErrRequestBudget
	}
	decoded := 0
	for p.pos < len(p.data) {
		c := p.data[p.pos]
		if c == '"' {
			p.pos++
			p.stringBytes += decoded
			if decoded > MaxJSONStringBytes || p.stringBytes > MaxJSONTotalStringBytes {
				return 0, ErrRequestBudget
			}
			return decoded, nil
		}
		if c < 0x20 {
			return 0, ErrRequestBudget
		}
		if c != '\\' {
			_, size := utf8.DecodeRune(p.data[p.pos:])
			if size == 0 {
				return 0, ErrRequestBudget
			}
			decoded += size
			p.pos += size
			continue
		}
		p.pos++
		if p.pos >= len(p.data) {
			return 0, ErrRequestBudget
		}
		switch p.data[p.pos] {
		case '"', '\\', '/', 'b', 'f', 'n', 'r', 't':
			decoded++
			p.pos++
		case 'u':
			r1, ok := p.unicodeEscape()
			if !ok {
				return 0, ErrRequestBudget
			}
			if utf16.IsSurrogate(r1) {
				if p.pos+2 > len(p.data) || p.data[p.pos] != '\\' || p.data[p.pos+1] != 'u' {
					return 0, ErrRequestBudget
				}
				p.pos++
				r2, ok := p.unicodeEscape()
				if !ok || !utf16.IsSurrogate(r2) {
					return 0, ErrRequestBudget
				}
				combined := utf16.DecodeRune(r1, r2)
				if combined == utf8.RuneError {
					return 0, ErrRequestBudget
				}
				decoded += utf8.RuneLen(combined)
			} else {
				decoded += utf8.RuneLen(r1)
			}
		default:
			return 0, ErrRequestBudget
		}
	}
	return 0, ErrRequestBudget
}

func (p *jsonPreflight) unicodeEscape() (rune, bool) {
	if p.pos >= len(p.data) || p.data[p.pos] != 'u' || p.pos+5 > len(p.data) {
		return 0, false
	}
	value := rune(0)
	for _, c := range p.data[p.pos+1 : p.pos+5] {
		value <<= 4
		switch {
		case c >= '0' && c <= '9':
			value += rune(c - '0')
		case c >= 'a' && c <= 'f':
			value += rune(c-'a') + 10
		case c >= 'A' && c <= 'F':
			value += rune(c-'A') + 10
		default:
			return 0, false
		}
	}
	p.pos += 5
	return value, true
}

func (p *jsonPreflight) number() error {
	start := p.pos
	if p.consume('-') && p.pos >= len(p.data) {
		return ErrRequestBudget
	}
	if p.consume('0') {
		if p.pos < len(p.data) && p.data[p.pos] >= '0' && p.data[p.pos] <= '9' {
			return ErrRequestBudget
		}
	} else if !p.digits() {
		return ErrRequestBudget
	}
	if p.consume('.') && !p.digits() {
		return ErrRequestBudget
	}
	if p.pos < len(p.data) && (p.data[p.pos] == 'e' || p.data[p.pos] == 'E') {
		p.pos++
		if p.pos < len(p.data) && (p.data[p.pos] == '+' || p.data[p.pos] == '-') {
			p.pos++
		}
		if !p.digits() {
			return ErrRequestBudget
		}
	}
	if p.pos == start {
		return ErrRequestBudget
	}
	return nil
}

func (p *jsonPreflight) digits() bool {
	start := p.pos
	for p.pos < len(p.data) && p.data[p.pos] >= '0' && p.data[p.pos] <= '9' {
		p.pos++
	}
	return p.pos > start
}

func (p *jsonPreflight) literal(want string) error {
	if !bytes.HasPrefix(p.data[p.pos:], []byte(want)) {
		return ErrRequestBudget
	}
	p.pos += len(want)
	return nil
}

func (p *jsonPreflight) skipSpace() {
	for p.pos < len(p.data) {
		switch p.data[p.pos] {
		case ' ', '\n', '\r', '\t':
			p.pos++
		default:
			return
		}
	}
}

func (p *jsonPreflight) consume(c byte) bool {
	if p.pos < len(p.data) && p.data[p.pos] == c {
		p.pos++
		return true
	}
	return false
}

func decodeStrict(data []byte, dst any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if decoder.More() {
		return errors.New("multiple JSON values")
	}
	var extra any
	if err := decoder.Decode(&extra); err == nil {
		return errors.New("multiple JSON values")
	}
	return nil
}

func retainedBytes(value any, max int64) (int64, error) {
	seen := make(map[visit]bool)
	n, err := retainedReflect(reflect.ValueOf(value), seen, 0, max)
	if err != nil || n > max {
		return n, ErrRequestBudget
	}
	return n, nil
}

type visit struct {
	typ reflect.Type
	ptr uintptr
}

func retainedReflect(v reflect.Value, seen map[visit]bool, depth int, max int64) (int64, error) {
	if !v.IsValid() || depth > MaxJSONDepth {
		return 0, nil
	}
	if v.Kind() == reflect.Interface {
		return 0, fmt.Errorf("unbounded interface field %s", v.Type())
	}
	n := int64(v.Type().Size())
	if n > max {
		return n, ErrRequestBudget
	}
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return n, nil
		}
		key := visit{typ: v.Type(), ptr: v.Pointer()}
		if seen[key] {
			return 0, fmt.Errorf("recursive request value")
		}
		seen[key] = true
		child, err := retainedReflect(v.Elem(), seen, depth+1, max-n)
		delete(seen, key)
		return n + child, err
	case reflect.String:
		return n + int64(v.Len()), nil
	case reflect.Slice:
		if v.IsNil() {
			return n, nil
		}
		if v.Cap() > MaxJSONRecords {
			return n, ErrRequestBudget
		}
		n += int64(v.Cap()) * int64(v.Type().Elem().Size())
		for i := 0; i < v.Len(); i++ {
			child, err := retainedReflect(v.Index(i), seen, depth+1, max-n)
			n += child
			if err != nil || n > max {
				return n, ErrRequestBudget
			}
		}
		return n, nil
	case reflect.Array:
		for i := 0; i < v.Len(); i++ {
			child, err := retainedReflect(v.Index(i), seen, depth+1, max-n)
			n += child
			if err != nil || n > max {
				return n, ErrRequestBudget
			}
		}
		return n, nil
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			child, err := retainedReflect(v.Field(i), seen, depth+1, max-n)
			n += child
			if err != nil || n > max {
				return n, ErrRequestBudget
			}
		}
		return n, nil
	case reflect.Map:
		return n, fmt.Errorf("unbounded map field %s", v.Type())
	default:
		return n, nil
	}
}
