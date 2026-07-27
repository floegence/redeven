package gitruntime

import (
	"encoding"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

var (
	errUnsupportedJSONType = errors.New("unsupported bounded JSON type")
	rawMessageType         = reflect.TypeOf(json.RawMessage(nil))
	boundedJSONFields      sync.Map
	boundedJSONTypes       sync.Map
)

// JSONEncodedSize returns the exact encoding/json-compatible size of value
// while failing as soon as the output would exceed maxBytes. The closed
// encoder intentionally supports only the DTO shapes used by Git RPCs.
func JSONEncodedSize(value any, maxBytes int) (int, error) {
	if maxBytes <= 0 || maxBytes > MaxResponsePayload {
		return 0, ErrResponseBudget
	}
	if value != nil {
		if err := validateBoundedJSONType(reflect.TypeOf(value), make(map[reflect.Type]bool)); err != nil {
			return 0, err
		}
	}
	encoder := boundedJSONEncoder{
		limit: maxBytes,
		stack: make(map[jsonEncodeVisit]bool),
	}
	if err := encoder.value(reflect.ValueOf(value), 0); err != nil {
		return 0, err
	}
	return encoder.size, nil
}

func validateBoundedJSONType(valueType reflect.Type, visiting map[reflect.Type]bool) error {
	if cached, ok := boundedJSONTypes.Load(valueType); ok {
		return cached.(errorResult).err
	}
	if visiting[valueType] {
		return nil
	}
	visiting[valueType] = true
	err := validateBoundedJSONTypeUncached(valueType, visiting)
	delete(visiting, valueType)
	boundedJSONTypes.LoadOrStore(valueType, errorResult{err: err})
	return err
}

type errorResult struct{ err error }

func validateBoundedJSONTypeUncached(valueType reflect.Type, visiting map[reflect.Type]bool) error {
	if valueType == rawMessageType {
		return nil
	}
	marshalerType := reflect.TypeOf((*json.Marshaler)(nil)).Elem()
	textMarshalerType := reflect.TypeOf((*encoding.TextMarshaler)(nil)).Elem()
	if valueType == reflect.TypeOf(json.Number("")) ||
		valueType.Implements(marshalerType) || valueType.Implements(textMarshalerType) ||
		(valueType.Kind() != reflect.Pointer && (reflect.PointerTo(valueType).Implements(marshalerType) || reflect.PointerTo(valueType).Implements(textMarshalerType))) {
		return errUnsupportedJSONType
	}
	switch valueType.Kind() {
	case reflect.Pointer:
		return validateBoundedJSONType(valueType.Elem(), visiting)
	case reflect.Struct:
		fields, err := jsonFieldsFor(valueType)
		if err != nil {
			return err
		}
		for _, field := range fields {
			fieldType := valueType
			for _, index := range field.index {
				if fieldType.Kind() == reflect.Pointer {
					fieldType = fieldType.Elem()
				}
				fieldType = fieldType.Field(index).Type
			}
			if err := validateBoundedJSONType(fieldType, visiting); err != nil {
				return err
			}
		}
		return nil
	case reflect.Slice:
		if valueType.Elem().Kind() == reflect.Uint8 {
			return errUnsupportedJSONType
		}
		return validateBoundedJSONType(valueType.Elem(), visiting)
	case reflect.Array:
		return validateBoundedJSONType(valueType.Elem(), visiting)
	case reflect.String, reflect.Bool,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return nil
	default:
		return errUnsupportedJSONType
	}
}

// MarshalJSONBounded encodes value without allowing either the returned slice
// or an intermediate encoding buffer to grow beyond maxBytes.
func MarshalJSONBounded(value any, maxBytes int) (json.RawMessage, error) {
	exactSize, err := JSONEncodedSize(value, maxBytes)
	if err != nil {
		return nil, err
	}
	storage := make([]byte, exactSize)
	encoder := boundedJSONEncoder{
		output: storage,
		limit:  exactSize,
		stack:  make(map[jsonEncodeVisit]bool),
	}
	if err := encoder.value(reflect.ValueOf(value), 0); err != nil {
		return nil, err
	}
	return json.RawMessage(storage[:encoder.size:encoder.size]), nil
}

type boundedJSONEncoder struct {
	output []byte
	size   int
	limit  int
	stack  map[jsonEncodeVisit]bool
}

type jsonEncodeVisit struct {
	typ reflect.Type
	ptr uintptr
}

func (e *boundedJSONEncoder) writeByte(value byte) error {
	if e.size >= e.limit {
		return ErrResponseBudget
	}
	if e.output != nil {
		e.output[e.size] = value
	}
	e.size++
	return nil
}

func (e *boundedJSONEncoder) writeString(value string) error {
	if len(value) > e.limit-e.size {
		return ErrResponseBudget
	}
	if e.output != nil {
		copy(e.output[e.size:], value)
	}
	e.size += len(value)
	return nil
}

func (e *boundedJSONEncoder) writeBytes(value []byte) error {
	if len(value) > e.limit-e.size {
		return ErrResponseBudget
	}
	if e.output != nil {
		copy(e.output[e.size:], value)
	}
	e.size += len(value)
	return nil
}

func (e *boundedJSONEncoder) value(value reflect.Value, depth int) error {
	if depth > MaxJSONDepth {
		return errUnsupportedJSONType
	}
	if !value.IsValid() {
		return e.writeString("null")
	}
	for value.Kind() == reflect.Interface {
		if value.IsNil() {
			return e.writeString("null")
		}
		value = value.Elem()
	}
	if value.Type() == rawMessageType {
		return e.rawMessage(value.Bytes())
	}

	switch value.Kind() {
	case reflect.Pointer:
		if value.IsNil() {
			return e.writeString("null")
		}
		visit := jsonEncodeVisit{typ: value.Type(), ptr: value.Pointer()}
		if e.stack[visit] {
			return errUnsupportedJSONType
		}
		e.stack[visit] = true
		err := e.value(value.Elem(), depth+1)
		delete(e.stack, visit)
		return err
	case reflect.Struct:
		return e.structValue(value, depth)
	case reflect.Slice:
		if value.IsNil() {
			return e.writeString("null")
		}
		visit := jsonEncodeVisit{typ: value.Type(), ptr: value.Pointer()}
		if value.Len() != 0 && e.stack[visit] {
			return errUnsupportedJSONType
		}
		if value.Len() != 0 {
			e.stack[visit] = true
			defer delete(e.stack, visit)
		}
		return e.sequence(value, depth)
	case reflect.Array:
		return e.sequence(value, depth)
	case reflect.String:
		return e.quotedString(value.String())
	case reflect.Bool:
		if value.Bool() {
			return e.writeString("true")
		}
		return e.writeString("false")
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		var scratch [32]byte
		encoded := strconv.AppendInt(scratch[:0], value.Int(), 10)
		return e.writeBytes(encoded)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		var scratch [32]byte
		encoded := strconv.AppendUint(scratch[:0], value.Uint(), 10)
		return e.writeBytes(encoded)
	default:
		return errUnsupportedJSONType
	}
}

func (e *boundedJSONEncoder) sequence(value reflect.Value, depth int) error {
	if err := e.writeByte('['); err != nil {
		return err
	}
	for index := 0; index < value.Len(); index++ {
		if index != 0 {
			if err := e.writeByte(','); err != nil {
				return err
			}
		}
		if err := e.value(value.Index(index), depth+1); err != nil {
			return err
		}
	}
	return e.writeByte(']')
}

func (e *boundedJSONEncoder) structValue(value reflect.Value, depth int) error {
	fields, err := jsonFieldsFor(value.Type())
	if err != nil {
		return err
	}
	if err := e.writeByte('{'); err != nil {
		return err
	}
	wroteField := false
	for _, field := range fields {
		fieldValue, ok := jsonFieldValue(value, field.index)
		if !ok || (field.omitEmpty && isEmptyJSONValue(fieldValue)) {
			continue
		}
		if wroteField {
			if err := e.writeByte(','); err != nil {
				return err
			}
		}
		wroteField = true
		if err := e.quotedString(field.name); err != nil {
			return err
		}
		if err := e.writeByte(':'); err != nil {
			return err
		}
		if err := e.value(fieldValue, depth+1); err != nil {
			return err
		}
	}
	return e.writeByte('}')
}

func isEmptyJSONValue(value reflect.Value) bool {
	switch value.Kind() {
	case reflect.Array, reflect.Map, reflect.Slice, reflect.String:
		return value.Len() == 0
	case reflect.Bool,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr,
		reflect.Interface, reflect.Pointer:
		return value.IsZero()
	default:
		return false
	}
}

func jsonFieldValue(value reflect.Value, index []int) (reflect.Value, bool) {
	for _, fieldIndex := range index {
		if value.Kind() == reflect.Pointer {
			if value.IsNil() {
				return reflect.Value{}, false
			}
			value = value.Elem()
		}
		value = value.Field(fieldIndex)
	}
	return value, true
}

func (e *boundedJSONEncoder) quotedString(value string) error {
	if err := e.writeByte('"'); err != nil {
		return err
	}
	start := 0
	for index := 0; index < len(value); {
		if value[index] < utf8.RuneSelf {
			character := value[index]
			if character >= 0x20 && character != '\\' && character != '"' && character != '<' && character != '>' && character != '&' {
				index++
				continue
			}
			if err := e.writeString(value[start:index]); err != nil {
				return err
			}
			switch character {
			case '\\', '"':
				if err := e.writeByte('\\'); err != nil {
					return err
				}
				if err := e.writeByte(character); err != nil {
					return err
				}
			case '\n':
				if err := e.writeString(`\n`); err != nil {
					return err
				}
			case '\r':
				if err := e.writeString(`\r`); err != nil {
					return err
				}
			case '\t':
				if err := e.writeString(`\t`); err != nil {
					return err
				}
			case '\b':
				if err := e.writeString(`\b`); err != nil {
					return err
				}
			case '\f':
				if err := e.writeString(`\f`); err != nil {
					return err
				}
			default:
				const hexadecimal = "0123456789abcdef"
				escaped := [6]byte{'\\', 'u', '0', '0', hexadecimal[character>>4], hexadecimal[character&0x0f]}
				if err := e.writeBytes(escaped[:]); err != nil {
					return err
				}
			}
			index++
			start = index
			continue
		}

		r, width := utf8.DecodeRuneInString(value[index:])
		if r == utf8.RuneError && width == 1 {
			if err := e.writeString(value[start:index]); err != nil {
				return err
			}
			if err := e.writeString(`\ufffd`); err != nil {
				return err
			}
			index++
			start = index
			continue
		}
		if r == '\u2028' || r == '\u2029' {
			if err := e.writeString(value[start:index]); err != nil {
				return err
			}
			if r == '\u2028' {
				if err := e.writeString(`\u2028`); err != nil {
					return err
				}
			} else if err := e.writeString(`\u2029`); err != nil {
				return err
			}
			index += width
			start = index
			continue
		}
		index += width
	}
	if err := e.writeString(value[start:]); err != nil {
		return err
	}
	return e.writeByte('"')
}

func (e *boundedJSONEncoder) rawMessage(raw []byte) error {
	if raw == nil {
		return e.writeString("null")
	}
	if !json.Valid(raw) {
		return errUnsupportedJSONType
	}
	inString := false
	escaped := false
	for _, character := range raw {
		if inString {
			if escaped {
				escaped = false
				if err := e.writeByte(character); err != nil {
					return err
				}
				continue
			}
			switch character {
			case '\\':
				escaped = true
				if err := e.writeByte(character); err != nil {
					return err
				}
			case '"':
				inString = false
				if err := e.writeByte(character); err != nil {
					return err
				}
			case '<', '>', '&':
				const hexadecimal = "0123456789abcdef"
				escapedHTML := [6]byte{'\\', 'u', '0', '0', hexadecimal[character>>4], hexadecimal[character&0x0f]}
				if err := e.writeBytes(escapedHTML[:]); err != nil {
					return err
				}
			default:
				if err := e.writeByte(character); err != nil {
					return err
				}
			}
			continue
		}
		switch character {
		case '"':
			inString = true
			if err := e.writeByte(character); err != nil {
				return err
			}
		case ' ', '\n', '\r', '\t':
			continue
		default:
			if err := e.writeByte(character); err != nil {
				return err
			}
		}
	}
	return nil
}

type boundedJSONField struct {
	name      string
	index     []int
	omitEmpty bool
	tagged    bool
}

type boundedJSONFieldResult struct {
	fields []boundedJSONField
	err    error
}

func jsonFieldsFor(structType reflect.Type) ([]boundedJSONField, error) {
	if cached, ok := boundedJSONFields.Load(structType); ok {
		result := cached.(boundedJSONFieldResult)
		return result.fields, result.err
	}
	fields, err := collectJSONFields(structType, nil, make(map[reflect.Type]bool), 0)
	if err == nil {
		sort.Slice(fields, func(i, j int) bool {
			if fields[i].name != fields[j].name {
				return fields[i].name < fields[j].name
			}
			if len(fields[i].index) != len(fields[j].index) {
				return len(fields[i].index) < len(fields[j].index)
			}
			if fields[i].tagged != fields[j].tagged {
				return fields[i].tagged
			}
			return lessFieldIndex(fields[i].index, fields[j].index)
		})
		selected := fields[:0]
		for start := 0; start < len(fields); {
			end := start + 1
			for end < len(fields) && fields[end].name == fields[start].name {
				end++
			}
			if end-start == 1 || len(fields[start].index) < len(fields[start+1].index) || fields[start].tagged != fields[start+1].tagged {
				selected = append(selected, fields[start])
			}
			start = end
		}
		fields = selected
		sort.Slice(fields, func(i, j int) bool { return lessFieldIndex(fields[i].index, fields[j].index) })
	}
	result := boundedJSONFieldResult{fields: fields, err: err}
	actual, _ := boundedJSONFields.LoadOrStore(structType, result)
	stored := actual.(boundedJSONFieldResult)
	return stored.fields, stored.err
}

func collectJSONFields(structType reflect.Type, prefix []int, visiting map[reflect.Type]bool, depth int) ([]boundedJSONField, error) {
	if depth > MaxJSONDepth || visiting[structType] {
		return nil, nil
	}
	visiting[structType] = true
	defer delete(visiting, structType)
	var fields []boundedJSONField
	for index := 0; index < structType.NumField(); index++ {
		field := structType.Field(index)
		fieldType := field.Type
		if fieldType.Kind() == reflect.Pointer {
			fieldType = fieldType.Elem()
		}
		if field.PkgPath != "" && (!field.Anonymous || fieldType.Kind() != reflect.Struct) {
			continue
		}
		tag := field.Tag.Get("json")
		if tag == "-" {
			continue
		}
		name, options := parseJSONTag(tag)
		if name != "" && !validJSONTagName(name) {
			name = ""
		}
		if options != "" && options != "omitempty" {
			return nil, errUnsupportedJSONType
		}
		fieldIndex := append(append([]int(nil), prefix...), index)
		if name != "" || !field.Anonymous || fieldType.Kind() != reflect.Struct {
			if name == "" {
				name = field.Name
			}
			fields = append(fields, boundedJSONField{
				name: name, index: fieldIndex, omitEmpty: options == "omitempty", tagged: tag != "" && strings.Split(tag, ",")[0] != "",
			})
			continue
		}
		embedded, err := collectJSONFields(fieldType, fieldIndex, visiting, depth+1)
		if err != nil {
			return nil, err
		}
		fields = append(fields, embedded...)
	}
	return fields, nil
}

func parseJSONTag(tag string) (string, string) {
	name, options, found := strings.Cut(tag, ",")
	if !found {
		return tag, ""
	}
	return name, options
}

func validJSONTagName(name string) bool {
	if name == "" {
		return false
	}
	for _, character := range name {
		if unicode.IsLetter(character) || unicode.IsDigit(character) || strings.ContainsRune("!#$%&()*+-./:;<=>?@[]^_{|}~ ", character) {
			continue
		}
		return false
	}
	return true
}

func lessFieldIndex(left, right []int) bool {
	for index := 0; index < len(left) && index < len(right); index++ {
		if left[index] != right[index] {
			return left[index] < right[index]
		}
	}
	return len(left) < len(right)
}
