package ai

import (
	"fmt"
	"path/filepath"

	"github.com/floegence/redeven/internal/ai/agentplugins"
)

func (m *skillManager) discoverPluginSkillsLocked(grouped map[string][]SkillMeta) {
	if m.plugins == nil {
		return
	}
	installs, _ := m.plugins.List()
	for _, in := range installs {
		for _, skill := range in.Package.Skills {
			// The qualified discovery name is also the existing use_skill selector.
			// It cannot collide with a standalone skill or a second installation.
			selector := in.Package.Manifest.Name + "@" + in.ID + "/" + skill.Name
			meta := SkillMeta{Name: selector, Description: skill.Description, Path: filepath.Join(m.plugins.Root(in), filepath.FromSlash(skill.Path)), Scope: "agent_plugin", AllowImplicitInvocation: true, PluginID: in.ID, PluginName: in.Package.Manifest.Name, PluginRevision: in.Revision, ComponentKey: skill.Key, PluginEnabled: in.Enabled && in.Components[skill.Key].Enabled}
			grouped[selector] = []SkillMeta{meta}
		}
	}
}
func (m *skillManager) skillEnabledLocked(meta SkillMeta) bool {
	if meta.PluginID != "" {
		return meta.PluginEnabled
	}
	return !m.isDisabledLocked(meta.Path)
}
func (m *skillManager) pluginSkillContentLocked(meta SkillMeta) (SkillMeta, string, error) {
	if m.plugins == nil {
		return SkillMeta{}, "", agentplugins.ErrUnavailable
	}
	_, release, err := m.plugins.Acquire(meta.PluginID, meta.PluginRevision, meta.ComponentKey)
	if err != nil {
		return SkillMeta{}, "", err
	}
	defer release()
	_, body, err := parseSkillFile(meta.Path, meta.Scope)
	if err != nil {
		return SkillMeta{}, "", err
	}
	if !m.plugins.Current(meta.PluginID, meta.PluginRevision, meta.ComponentKey) {
		return SkillMeta{}, "", fmt.Errorf("plugin component changed")
	}
	return meta, body, nil
}
