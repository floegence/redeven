package main

import (
	"fmt"
	"os"
	"strings"
)

type envTokenOptions struct {
	token    string
	tokenEnv string
}

type envTokenOptionErrorKind string

const (
	envTokenOptionErrorMultipleSources envTokenOptionErrorKind = "multiple_sources"
	envTokenOptionErrorEnvNotSet       envTokenOptionErrorKind = "env_not_set"
	envTokenOptionErrorEnvEmpty        envTokenOptionErrorKind = "env_empty"
)

type envTokenOptionError struct {
	kind    envTokenOptionErrorKind
	envName string
}

func (e *envTokenOptionError) Error() string {
	if e == nil {
		return ""
	}
	switch e.kind {
	case envTokenOptionErrorMultipleSources:
		return "use only one of --env-token or --env-token-env"
	case envTokenOptionErrorEnvNotSet:
		return fmt.Sprintf("environment token env var %q is not set", e.envName)
	case envTokenOptionErrorEnvEmpty:
		return fmt.Sprintf("environment token env var %q is empty", e.envName)
	default:
		return "invalid environment token flags"
	}
}

func resolveEnvToken(opts envTokenOptions) (string, error) {
	token := strings.TrimSpace(opts.token)
	tokenEnv := strings.TrimSpace(opts.tokenEnv)
	switch {
	case token != "" && tokenEnv != "":
		return "", &envTokenOptionError{kind: envTokenOptionErrorMultipleSources}
	case token != "":
		return token, nil
	case tokenEnv != "":
		value, ok := os.LookupEnv(tokenEnv)
		if !ok {
			return "", &envTokenOptionError{kind: envTokenOptionErrorEnvNotSet, envName: tokenEnv}
		}
		if strings.TrimSpace(value) == "" {
			return "", &envTokenOptionError{kind: envTokenOptionErrorEnvEmpty, envName: tokenEnv}
		}
		return value, nil
	default:
		return "", nil
	}
}
