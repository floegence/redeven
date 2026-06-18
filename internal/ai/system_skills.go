package ai

import (
	"embed"
	"io/fs"
	"path"
	"sort"
	"strings"
)

//go:embed system_skills/*/SKILL.md
var systemSkillFS embed.FS

type embeddedSkill struct {
	Path    string
	Content string
}

func embeddedSystemSkills() []embeddedSkill {
	matches, err := fs.Glob(systemSkillFS, "system_skills/*/SKILL.md")
	if err != nil || len(matches) == 0 {
		return nil
	}
	sort.Strings(matches)
	out := make([]embeddedSkill, 0, len(matches))
	for _, match := range matches {
		content, err := systemSkillFS.ReadFile(match)
		if err != nil {
			continue
		}
		name := strings.TrimSpace(path.Base(path.Dir(match)))
		if name == "" {
			continue
		}
		out = append(out, embeddedSkill{
			Path:    "system:" + name + "/SKILL.md",
			Content: string(content),
		})
	}
	return out
}
