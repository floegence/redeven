package flowerhost

import "strings"

type codedServiceError interface {
	error
	ErrorCode() string
	HTTPStatus() int
}

type serviceError struct {
	status  int
	code    string
	message string
}

func newServiceError(status int, code string, message string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		code = "flower_host_error"
	}
	message = strings.TrimSpace(message)
	if message == "" {
		message = "Flower Host request failed."
	}
	return serviceError{
		status:  status,
		code:    code,
		message: message,
	}
}

func (e serviceError) Error() string {
	return e.message
}

func (e serviceError) ErrorCode() string {
	return e.code
}

func (e serviceError) HTTPStatus() int {
	if e.status <= 0 {
		return 400
	}
	return e.status
}
