package environmentcenter

import "context"

// Gateway lookups and pairing share the device's cancellation authority. Their
// short-request budget is separate from proxy streams and security actions so
// a stalled source cannot block logout or consume every other source's slots.
func (s *Server) gatewayRequest(parent context.Context, token, source string) (context.Context, func(), error) {
	s.center.mu.Lock()
	defer s.center.mu.Unlock()
	device, err := s.center.sessionLocked(token)
	if err != nil {
		return nil, nil, err
	}
	deviceKey := device.Device
	sourceKey := deviceKey + ":" + source
	s.mu.Lock()
	if s.gatewayTotal >= 32 || s.gatewayDevices[deviceKey] >= 8 || s.gatewaySources[sourceKey] >= 2 {
		s.mu.Unlock()
		return nil, nil, ErrBusy
	}
	s.gatewayTotal++
	s.gatewayDevices[deviceKey]++
	s.gatewaySources[sourceKey]++
	s.mu.Unlock()
	ctx, cancel := context.WithCancel(parent)
	detach := context.AfterFunc(device.Context, cancel)
	return ctx, func() {
		detach()
		cancel()
		s.mu.Lock()
		defer s.mu.Unlock()
		s.gatewayTotal--
		s.gatewayDevices[deviceKey]--
		s.gatewaySources[sourceKey]--
		if s.gatewayDevices[deviceKey] == 0 {
			delete(s.gatewayDevices, deviceKey)
		}
		if s.gatewaySources[sourceKey] == 0 {
			delete(s.gatewaySources, sourceKey)
		}
	}, nil
}
