package uptime

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/core"
)

// checkDns performs a DNS record check. Returns success, elapsed ms, error msg.
func checkDns(ctx context.Context, rec *core.Record) (bool, int64, string) {
	host, _ := monitorTarget(rec)
	name := strings.TrimSuffix(strings.TrimSpace(host), ".")
	if name == "" {
		return false, 0, "No host provided"
	}

	qtype := strings.ToLower(strings.TrimSpace(rec.GetString("dns_type")))
	if qtype == "" {
		qtype = "a"
	}
	expected := strings.ToLower(strings.TrimSpace(rec.GetString("dns_value")))

	start := time.Now()
	records, err := dnsLookup(ctx, name, qtype)
	elapsed := time.Since(start)
	if err != nil {
		return false, elapsed.Milliseconds(), "DNS lookup failed: " + err.Error()
	}

	if expected == "" {
		return len(records) > 0, elapsed.Milliseconds(), ""
	}
	for _, record := range records {
		if strings.Contains(strings.ToLower(record), expected) {
			return true, elapsed.Milliseconds(), ""
		}
	}
	return false, elapsed.Milliseconds(), fmt.Sprintf("Expected value %q not found", expected)
}

// checkDocker queries the Docker Engine API for a container's running state.
func checkDocker(ctx context.Context, rec *core.Record) (bool, int64, string) {
	base := strings.TrimSpace(rec.GetString("docker_url"))
	if base == "" {
		base = "unix:///var/run/docker.sock"
	}
	u, err := url.Parse(base)
	if err != nil {
		return false, 0, "Invalid Docker URL: " + err.Error()
	}

	var client *http.Client
	switch u.Scheme {
	case "unix":
		socket := u.Path
		transport := &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				var d net.Dialer
				return d.DialContext(ctx, "unix", socket)
			},
		}
		client = &http.Client{Transport: transport}
	case "http", "https":
		if u.Host == "" {
			return false, 0, "Docker URL missing host"
		}
		client = &http.Client{}
	default:
		return false, 0, "Unsupported Docker URL scheme: " + u.Scheme
	}

	container, _ := monitorTarget(rec)
	if container == "" {
		return false, 0, "No container name or id provided"
	}

	endpoint := "/v1.45/containers/" + url.PathEscape(container) + "/json"
	if u.Scheme != "unix" {
		endpoint = u.Scheme + "://" + u.Host + endpoint
	} else {
		endpoint = "http://docker" + endpoint
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false, 0, "Invalid request: " + err.Error()
	}

	start := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		return false, elapsed.Milliseconds(), "Docker API error: " + err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return false, elapsed.Milliseconds(), "Container not found"
	}
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < 300 {
		var state struct {
			State string `json:"State"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&state); err != nil {
			return false, elapsed.Milliseconds(), "Docker API parse error: " + err.Error()
		}
		if strings.EqualFold(state.State, "running") {
			return true, elapsed.Milliseconds(), ""
		}
		return false, elapsed.Milliseconds(), "Container state: " + state.State
	}
	return false, elapsed.Milliseconds(), fmt.Sprintf("Docker API status %d", resp.StatusCode)
}

// checkWebSocket connects to a WebSocket endpoint and, when an expected body is
// set, waits for a message containing that substring.
func checkWebSocket(ctx context.Context, rec *core.Record) (bool, int64, string) {
	target := strings.TrimSpace(rec.GetString("url"))
	if target == "" {
		return false, 0, "No URL provided"
	}
	if !strings.Contains(target, "://") {
		target = "ws://" + target
	}
	if strings.HasPrefix(target, "http://") {
		target = "ws://" + strings.TrimPrefix(target, "http://")
	}
	if strings.HasPrefix(target, "https://") {
		target = "wss://" + strings.TrimPrefix(target, "https://")
	}

	headers := http.Header{}
	var headerMap map[string]any
	if err := rec.UnmarshalJSONField("headers", &headerMap); err == nil {
		for k, v := range headerMap {
			if s, ok := v.(string); ok && s != "" {
				headers.Set(k, s)
			}
		}
	}

	dialer := &websocket.Dialer{}
	if !rec.GetBool("secure") {
		dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // user opt-in per monitor
	}

	start := time.Now()
	conn, resp, err := dialer.DialContext(ctx, target, headers)
	if err != nil {
		elapsed := time.Since(start).Milliseconds()
		msg := err.Error()
		if resp != nil {
			msg = fmt.Sprintf("Handshake failed: %d %s", resp.StatusCode, resp.Status)
		}
		return false, elapsed, "WebSocket: " + msg
	}
	defer conn.Close()

	expected := strings.TrimSpace(rec.GetString("expected_body"))
	if expected == "" {
		return true, time.Since(start).Milliseconds(), ""
	}

	readTimeout := time.Duration(rec.GetInt("timeout")) * time.Second
	if readTimeout <= 0 {
		readTimeout = 10 * time.Second
	}
	_ = conn.SetReadDeadline(time.Now().Add(readTimeout))
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			return false, time.Since(start).Milliseconds(), "Closed before expected message"
		}
		if strings.Contains(string(message), expected) {
			return true, time.Since(start).Milliseconds(), ""
		}
	}
}

// checkSteam checks Steam app availability via the Steam Web API.
func checkSteam(ctx context.Context, rec *core.Record) (bool, int64, string) {
	appID := strings.TrimSpace(rec.GetString("app_id"))
	if appID == "" {
		appID = strings.TrimSpace(rec.GetString("url")) // allow pasting the app id as the url
	}
	if !isNumeric(appID) {
		return false, 0, "No valid Steam app id provided"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.steampowered.com/ISteamApps/GetAppDetails/v1/"+appID+"/?l=en", nil)
	if err != nil {
		return false, 0, "Invalid request"
	}

	start := time.Now()
	resp, err := http.DefaultClient.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		return false, elapsed.Milliseconds(), "Steam API error: " + err.Error()
	}
	defer resp.Body.Close()

	var details struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&details); err != nil {
		return false, elapsed.Milliseconds(), "Steam API parse error: " + err.Error()
	}
	if !details.Success {
		return false, elapsed.Milliseconds(), "Steam app id not found"
	}
	return true, elapsed.Milliseconds(), ""
}

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// checkCertExpiry validates the TLS certificate of a host and reports failure
// when it expires within 14 days (or has already expired).
func checkCertExpiry(ctx context.Context, host string, port int) (bool, int64, string) {
	if port == 0 {
		port = 443
	}
	dialer := &net.Dialer{}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprint(port)))
	if err != nil {
		return false, 0, "Could not connect to " + host
	}
	defer conn.Close()

	// VerifyPeerCertificate always accepts so we can inspect the presented
	// certificate (expiry checks work for self-signed / untrusted certs),
	// without using InsecureSkipVerify (which would also skip hostname checks).
	tlsConn := tls.Client(conn, &tls.Config{
		ServerName:            host,
		VerifyPeerCertificate: func([][]byte, [][]*x509.Certificate) error { return nil },
	})
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		return false, 0, "TLS handshake failed: " + err.Error()
	}
	certs := tlsConn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return false, 0, "No certificate presented"
	}
	remaining := time.Until(certs[0].NotAfter)
	days := int(remaining.Hours() / 24)
	if remaining < 0 {
		return false, 0, "Certificate expired " + certs[0].NotAfter.Format(time.RFC3339)
	}
	if days < 14 {
		return false, 0, fmt.Sprintf("Certificate expires in %d day(s) (%s)", days, certs[0].NotAfter.Format("Jan 2, 2006"))
	}
	return true, 0, "Certificate valid until " + certs[0].NotAfter.Format("Jan 2, 2006")
}

// dnsLookup resolves a record of the given type using the platform resolver.
func dnsLookup(ctx context.Context, name, qtype string) ([]string, error) {
	resolver := net.DefaultResolver
	switch strings.ToLower(qtype) {
	case "a":
		ips, err := resolver.LookupIPAddr(ctx, name)
		if err != nil {
			return nil, err
		}
		out := make([]string, 0, len(ips))
		for _, ip := range ips {
			if ip.IP.To4() != nil {
				out = append(out, ip.IP.String())
			}
		}
		sort.Strings(out)
		return out, nil
	case "aaaa":
		ips, err := resolver.LookupIPAddr(ctx, name)
		if err != nil {
			return nil, err
		}
		var out []string
		for _, ip := range ips {
			if ip.IP.To4() == nil {
				out = append(out, ip.IP.String())
			}
		}
		sort.Strings(out)
		return out, nil
	case "cname":
		cname, err := resolver.LookupCNAME(ctx, name)
		if err != nil {
			return nil, err
		}
		return []string{cname}, nil
	case "mx":
		mxs, err := resolver.LookupMX(ctx, name)
		if err != nil {
			return nil, err
		}
		out := make([]string, 0, len(mxs))
		for _, mx := range mxs {
			out = append(out, fmt.Sprintf("%d %s", mx.Pref, mx.Host))
		}
		sort.Strings(out)
		return out, nil
	case "txt":
		return resolver.LookupTXT(ctx, name)
	case "ns":
		ns, err := resolver.LookupNS(ctx, name)
		if err != nil {
			return nil, err
		}
		out := make([]string, 0, len(ns))
		for _, n := range ns {
			out = append(out, n.Host)
		}
		sort.Strings(out)
		return out, nil
	}
	return nil, fmt.Errorf("unsupported dns type %s", qtype)
}
