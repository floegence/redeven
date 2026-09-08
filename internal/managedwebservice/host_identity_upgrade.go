package managedwebservice

import (
	"context"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type hostIdentityUpgrade struct {
	OldIdentity string                   `json:"old_identity"`
	NewIdentity string                   `json:"new_identity"`
	State       hostRunState             `json:"state"`
	Session     *serviceOpenSessionState `json:"session,omitempty"`
}

func (d *hostScriptDriver) upgradeLegacyHostIdentity(service *pfregistry.ManagedService, parsed parsedHostIdentity, snapshot managedProcessSnapshot) (hostProcess, bool, error) {
	fingerprint, group, _, err := legacyManagedProcessDetails(parsed.pid)
	if err != nil || group != parsed.pid || fingerprint != parsed.fingerprint {
		return hostProcess{}, false, serviceError("HOST_PROCESS_IDENTITY_MISMATCH", "The legacy Host identity cannot be verified. Review the running process to restore management.", 409, false, nil)
	}
	if err := d.commitHostIdentityUpgrade(service, snapshot); err != nil {
		return hostProcess{}, false, err
	}
	return hostProcess{identity: service.RuntimeIdentity, pid: snapshot.PID, fingerprint: snapshot.fingerprint()}, true, nil
}

func (d *hostScriptDriver) commitHostIdentityUpgrade(service *pfregistry.ManagedService, snapshot managedProcessSnapshot) error {
	oldIdentity := service.RuntimeIdentity
	parsed := parseHostIdentity(oldIdentity)
	nonce := parsed.nonce
	if !strings.HasPrefix(nonce, "proc_") {
		var err error
		nonce, err = randomID("proc")
		if err != nil {
			return err
		}
	}
	identity := "host:v3:" + service.ServiceID + ":" + nonce + ":" + strconv.Itoa(snapshot.PID) + ":" + snapshot.fingerprint()
	forward, err := d.manager.registry.GetForward(context.Background(), service.ForwardID)
	if err != nil || forward == nil {
		return serviceError("FORWARD_NOT_FOUND", "The service opening route is unavailable.", 409, false, nil)
	}
	target, err := url.Parse(forward.TargetURL)
	if err != nil || target.Scheme == "" {
		return errors.New("invalid saved service route")
	}
	endpoint := WebEndpointSpec{Scheme: target.Scheme, Path: target.RequestURI(), HealthPath: forward.HealthPath}
	state := hostRunState{SchemaVersion: 1, RuntimeIdentity: identity, RuntimeSpecSHA256: service.RuntimeSpecSHA256, Endpoint: endpoint, OutputMode: "discard", AfterStartComplete: true}
	upgrade := hostIdentityUpgrade{OldIdentity: oldIdentity, NewIdentity: identity, State: state}
	appPath, sessionErr := d.readOpenSession(service, oldIdentity)
	if sessionErr != nil {
		if _, fileErr := os.Lstat(d.openSessionPath(service)); !errors.Is(fileErr, os.ErrNotExist) {
			return sessionErr
		}
		if resolved, resolveErr := d.manager.resolveCurrentRuntime(context.Background(), service); resolveErr == nil && resolved.Spec.Host != nil && resolved.Spec.Host.OpenScript == "" {
			appPath = endpoint.Path
		}
	}
	if appPath != "" {
		upgrade.Session = &serviceOpenSessionState{SchemaVersion: 1, ServiceID: service.ServiceID, RuntimeSpecSHA256: service.RuntimeSpecSHA256, RuntimeIdentity: identity, AppPath: appPath}
	}
	if err := writePrivateJSON(filepath.Join(d.instanceRoot(service), "identity-upgrade.json"), upgrade); err != nil {
		return err
	}
	return d.finishHostIdentityUpgrade(service, upgrade)
}

func (d *hostScriptDriver) finishHostIdentityUpgrade(service *pfregistry.ManagedService, upgrade hostIdentityUpgrade) error {
	if service.RuntimeIdentity != upgrade.OldIdentity && service.RuntimeIdentity != upgrade.NewIdentity {
		return errors.New("Host identity upgrade no longer owns this launch")
	}
	parsed := parseHostIdentity(upgrade.NewIdentity)
	snapshot, err := readManagedProcess(parsed.pid)
	if err != nil || snapshot.Group != parsed.pid || snapshot.fingerprint() != parsed.fingerprint || parsed.serviceID != service.ServiceID || upgrade.State.RuntimeIdentity != upgrade.NewIdentity || upgrade.State.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 {
		return serviceError("HOST_PROCESS_IDENTITY_MISMATCH", "The Host process changed during identity upgrade.", 409, false, nil)
	}
	if err := privateDirectory(filepath.Join(d.instanceRoot(service), "runs")); err != nil {
		return err
	}
	upgraded := *service
	upgraded.RuntimeIdentity = upgrade.NewIdentity
	if err := privateDirectory(d.runDirectory(&upgraded)); err != nil {
		return err
	}
	if err := d.writeRunState(&upgraded, upgrade.State); err != nil {
		return err
	}
	if upgrade.Session != nil {
		if upgrade.Session.SchemaVersion != 1 || upgrade.Session.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 || upgrade.Session.ServiceID != service.ServiceID || upgrade.Session.RuntimeIdentity != upgrade.NewIdentity || !validServiceOpeningPath(upgrade.Session.AppPath, true) {
			return errors.New("Host opening information does not match identity upgrade")
		}
	}
	if err := d.manager.registry.UpdateManagedServiceIfRuntimeMatches(context.Background(), service.ServiceID, service.RuntimeIdentity, service.RuntimeSpecSHA256, pfregistry.ManagedServicePatch{RuntimeIdentity: &upgrade.NewIdentity}); err != nil {
		return err
	}
	service.RuntimeIdentity = upgrade.NewIdentity
	if upgrade.Session != nil {
		if err := writePrivateJSON(d.openSessionPath(service), upgrade.Session); err != nil {
			return err
		}
	}
	d.processMu.Lock()
	if current, ok := d.processes[service.ServiceID]; ok && current.identity == upgrade.OldIdentity {
		current.identity, current.fingerprint = upgrade.NewIdentity, snapshot.fingerprint()
		d.processes[service.ServiceID] = current
	}
	d.processMu.Unlock()
	return os.Remove(filepath.Join(d.instanceRoot(service), "identity-upgrade.json"))
}

func (d *hostScriptDriver) resumeHostIdentityUpgrade(service *pfregistry.ManagedService) error {
	path := filepath.Join(d.instanceRoot(service), "identity-upgrade.json")
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 64*1024 {
		return errors.New("Host identity upgrade record is invalid")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var upgrade hostIdentityUpgrade
	if err := decodeStrictJSON(raw, &upgrade); err != nil {
		return err
	}
	return d.finishHostIdentityUpgrade(service, upgrade)
}
