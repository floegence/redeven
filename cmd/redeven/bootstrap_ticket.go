package main

import (
	"fmt"
	"os"
	"strings"
)

type bootstrapTicketOptions struct {
	ticket    string
	ticketEnv string
}

type bootstrapTicketOptionErrorKind string

const (
	bootstrapTicketOptionErrorMultipleSources bootstrapTicketOptionErrorKind = "multiple_sources"
	bootstrapTicketOptionErrorEnvNotSet       bootstrapTicketOptionErrorKind = "env_not_set"
	bootstrapTicketOptionErrorEnvEmpty        bootstrapTicketOptionErrorKind = "env_empty"
)

type bootstrapTicketOptionError struct {
	kind    bootstrapTicketOptionErrorKind
	envName string
}

func (e *bootstrapTicketOptionError) Error() string {
	if e == nil {
		return ""
	}
	switch e.kind {
	case bootstrapTicketOptionErrorMultipleSources:
		return "use only one of --bootstrap-ticket or --bootstrap-ticket-env"
	case bootstrapTicketOptionErrorEnvNotSet:
		return fmt.Sprintf("bootstrap ticket env var %q is not set", e.envName)
	case bootstrapTicketOptionErrorEnvEmpty:
		return fmt.Sprintf("bootstrap ticket env var %q is empty", e.envName)
	default:
		return "invalid bootstrap ticket flags"
	}
}

func resolveBootstrapTicket(opts bootstrapTicketOptions) (string, error) {
	ticket := strings.TrimSpace(opts.ticket)
	ticketEnv := strings.TrimSpace(opts.ticketEnv)
	switch {
	case ticket != "" && ticketEnv != "":
		return "", &bootstrapTicketOptionError{kind: bootstrapTicketOptionErrorMultipleSources}
	case ticket != "":
		return ticket, nil
	case ticketEnv != "":
		value, ok := os.LookupEnv(ticketEnv)
		if !ok {
			return "", &bootstrapTicketOptionError{kind: bootstrapTicketOptionErrorEnvNotSet, envName: ticketEnv}
		}
		if strings.TrimSpace(value) == "" {
			return "", &bootstrapTicketOptionError{kind: bootstrapTicketOptionErrorEnvEmpty, envName: ticketEnv}
		}
		return value, nil
	default:
		return "", nil
	}
}
