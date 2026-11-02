package ai

import (
	"embed"
	"io/fs"
	"path"
	"sort"
	"strings"

	platformversion "github.com/floegence/redevplugin/v3/pkg/version"
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
		resolved := string(content)
		if name == "redeven-plugin-authoring" {
			resolved = strings.ReplaceAll(resolved, "{{REDEVPLUGIN_PLATFORM_VERSION}}", platformversion.CurrentPlatformVersion())
		}
		out = append(out, embeddedSkill{
			Path:    "system:" + name + "/SKILL.md",
			Content: resolved,
		})
	}
	return out
}
