package installer

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const pathBlockStart = "# >>> Redeven installer >>>"
const pathBlockEnd = "# <<< Redeven installer <<<"

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func pathInstruction(c Config) (string, string) {
	switch filepath.Base(c.Shell) {
	case "bash":
		name := ".bashrc"
		if runtime.GOOS == "darwin" {
			name = ".bash_profile"
		}
		return filepath.Join(c.Home, name), "export PATH=" + shellQuote(c.InstallDir) + ":\"$PATH\""
	case "zsh":
		return filepath.Join(c.Home, ".zshrc"), "export PATH=" + shellQuote(c.InstallDir) + ":\"$PATH\""
	case "fish":
		quoted := "'" + strings.NewReplacer("\\", "\\\\", "'", "\\'").Replace(c.InstallDir) + "'"
		return filepath.Join(c.Home, ".config", "fish", "config.fish"), "set -gx PATH " + quoted + " $PATH"
	default:
		return "", "export PATH=" + shellQuote(c.InstallDir) + ":\"$PATH\""
	}
}

func updatePathBlock(original []byte, instruction string) ([]byte, error) {
	lines := strings.Split(string(original), "\n")
	start, end := -1, -1
	for index, line := range lines {
		switch line {
		case pathBlockStart:
			if start >= 0 {
				return nil, errors.New("shell configuration contains duplicate Redeven managed blocks")
			}
			start = index
		case pathBlockEnd:
			if end >= 0 {
				return nil, errors.New("shell configuration contains duplicate Redeven managed blocks")
			}
			end = index
		}
	}
	if (start < 0) != (end < 0) || (start >= 0 && end < start) {
		return nil, errors.New("shell configuration contains an incomplete Redeven managed block")
	}
	block := []string{pathBlockStart, instruction, pathBlockEnd}
	if start >= 0 {
		updated := append(append(append([]string{}, lines[:start]...), block...), lines[end+1:]...)
		return []byte(strings.Join(updated, "\n")), nil
	}
	result := append([]byte{}, original...)
	if len(result) > 0 && result[len(result)-1] != '\n' {
		result = append(result, '\n')
	}
	return append(result, []byte("\n"+strings.Join(block, "\n")+"\n")...), nil
}

func configurePath(c Config) error {
	if c.Mode == "upgrade" {
		return nil
	}
	for _, directory := range filepath.SplitList(os.Getenv("PATH")) {
		if filepath.Clean(directory) == c.InstallDir {
			return nil
		}
	}
	config, instruction := pathInstruction(c)
	fmt.Fprintf(c.Output, "To use Redeven in this terminal, run:\n  %s\n", instruction)
	if config == "" {
		fmt.Fprintf(c.Output, "The shell was not recognized. You can also run %s directly.\n", shellQuote(filepath.Join(c.InstallDir, "redeven")))
		return nil
	}
	info, err := os.Lstat(config)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if info != nil && (!info.Mode().IsRegular() || info.Size() > 2<<20) {
		return errors.New("shell configuration is not a bounded regular file; update PATH manually")
	}
	var original []byte
	if info != nil {
		original, err = os.ReadFile(config)
		if err != nil {
			return err
		}
	}
	updated, err := updatePathBlock(original, instruction)
	if err != nil || bytes.Equal(original, updated) {
		return err
	}
	if err := realDirectory(filepath.Dir(config), true); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(config), ".redeven-shell-")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	if _, err = temporary.Write(updated); err == nil && info != nil {
		err = temporary.Chmod(info.Mode().Perm())
	}
	if err == nil {
		err = temporary.Sync()
	}
	if err := errors.Join(err, temporary.Close()); err != nil {
		return err
	}
	current, err := os.Lstat(config)
	if info == nil {
		if !errors.Is(err, os.ErrNotExist) {
			return errors.New("shell configuration appeared while PATH was being prepared")
		}
	} else if err != nil || !os.SameFile(info, current) || info.Size() != current.Size() || !info.ModTime().Equal(current.ModTime()) {
		return errors.New("shell configuration changed while PATH was being prepared")
	}
	if err := os.Rename(temporary.Name(), config); err != nil {
		return err
	}
	fmt.Fprintf(c.Output, "PATH configured in %s for new terminal sessions.\n", config)
	return syncDirectory(filepath.Dir(config))
}
