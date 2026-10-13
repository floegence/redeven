package config

import "errors"

var ErrCloudRouteConflict = errors.New("cloud route changed; refresh and review the current route")

// SaveCloudRoute is the commit boundary after the caller has completed transport
// preflight and user confirmation. It never changes Cloud ownership or generation.
func SaveCloudRoute(path string, expectedRevision int64, selection CloudRoute) (*Config, error) {
	unlock := lockConfig(path)
	defer unlock()
	return saveCloudRoute(path, expectedRevision, selection, defaultConfigPersistence())
}

func saveCloudRoute(path string, expectedRevision int64, selection CloudRoute, persistence configPersistence) (*Config, error) {
	if expectedRevision < 0 {
		return nil, ErrCloudRouteConflict
	}
	current, err := loadConfig(path, persistence)
	if err != nil {
		return nil, err
	}
	var revision int64
	if current.CloudRoute != nil {
		revision = current.CloudRoute.Revision
	}
	if revision != expectedRevision || revision == int64(^uint64(0)>>1) {
		return nil, ErrCloudRouteConflict
	}
	selection.Revision = revision + 1
	if !selection.Valid() {
		return nil, errors.New("invalid Cloud route selection")
	}
	if selection.Kind == CloudRouteGateway {
		next := *current
		next.CloudRoute = &selection
		if next.CloudRouteMember() == nil || next.CloudRouteMember().Leaving {
			return nil, errors.New("selected Gateway member is no longer available")
		}
	}
	next := *current
	next.CloudRoute = &selection
	if err := saveConfig(path, &next, persistence); err != nil {
		return nil, err
	}
	return &next, nil
}
