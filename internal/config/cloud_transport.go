package config

import "github.com/floegence/flowersec/flowersec-go/v5/egress"

func (c *Config) CloudProxy() (*egress.HTTPSProxy, error) {
	if err := c.ValidateCloudRoute(); err != nil {
		return nil, err
	}
	if c.CloudRoute.Kind == CloudRouteDirect {
		return nil, nil
	}
	member := c.CloudRouteMember()
	tlsConfig, err := member.TLSConfig(true)
	if err != nil {
		return nil, err
	}
	var urls []string
	for _, endpoint := range member.ConnectionEndpoints() {
		urls = append(urls, endpoint.Address)
	}
	return egress.NewHTTPSProxy(egress.HTTPSProxyOptions{URLs: urls, TLSConfig: tlsConfig})
}
