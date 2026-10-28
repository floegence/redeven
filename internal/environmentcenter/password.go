package environmentcenter

import (
	"errors"
	"strings"
)

// A local, versioned denylist keeps setup independent of external identity or
// breach-query services. Password bytes are hashed unchanged after validation.
var commonPasswords = map[string]bool{
	"password1234": true, "password12345": true, "password123456": true,
	"password123!": true, "password1234!": true, "password12345!": true,
	"123456789012": true, "1234567890123": true, "12345678901234": true,
	"123456789012345": true, "1234567890123456": true, "qwertyuiop12": true,
	"qwertyuiop123": true, "qwertyuiop12345": true, "administrator": true,
	"administrator1": true, "admin12345678": true, "admin123456789": true,
	"changeme12345": true, "changeme123456": true, "welcome123456": true,
	"p@ssw0rd12345": true, "p@ssw0rd123456": true, "iloveyou12345": true,
}

func passwordPolicy(password string) error {
	if !validPassword(password) {
		return errors.New("CENTER_PASSWORD_LENGTH")
	}
	normalized := strings.ToLower(strings.TrimSpace(password))
	repeated := true
	runes := []rune(normalized)
	for _, value := range runes {
		if value != runes[0] {
			repeated = false
			break
		}
	}
	if commonPasswords[normalized] || repeated {
		return errors.New("CENTER_PASSWORD_COMMON")
	}
	return nil
}
