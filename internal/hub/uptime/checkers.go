package uptime

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

// maxBodyBytes limits how much response body we read for expected_body checks.
const maxBodyBytes = 64 * 1024

// pingID identifies our echo requests among other traffic.
var pingID = int16(os.Getpid() & 0x7fff)

var (
	httpClientOnce sync.Once
	secureClient   *http.Client
	insecureClient *http.Client
)

func initHTTPClients() {
	redirectLimit := func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		return nil
	}
	secureClient = &http.Client{CheckRedirect: redirectLimit}
	insecureClient = &http.Client{
		Transport:     &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}, //nolint:gosec // user opt-in per monitor
		CheckRedirect: redirectLimit,
	}
}

// monitorTarget returns the host and port parsed from the record.
func monitorTarget(rec *core.Record) (host string, port int) {
	host = strings.TrimSpace(rec.GetString("host"))
	port = rec.GetInt("port")
	// fall back to the url for http monitors without an explicit host
	if host == "" {
		if u, err := url.Parse(rec.GetString("url")); err == nil && u.Host != "" {
			host = u.Host
		}
	}
	return host, port
}

// runCheck performs a single check of the given monitor type and returns
// success, elapsed time in ms and an error message (empty on success).
func runCheck(ctx context.Context, rec *core.Record) (bool, int64, string) {
	switch rec.GetString("type") {
	case "http":
		return checkHTTP(ctx, rec)
	case "tcp":
		return checkTCP(ctx, rec)
	case "ping":
		return checkPing(ctx, rec)
	case "dns":
		return checkDns(ctx, rec)
	case "docker":
		return checkDocker(ctx, rec)
	case "websocket":
		return checkWebSocket(ctx, rec)
	case "steam":
		return checkSteam(ctx, rec)
	case "push":
		return checkPush(ctx, rec)
	default:
		return false, 0, "Unknown monitor type"
	}
}

// checkPush validates push monitors by comparing the recorded last_ping time
// against the check interval (uptime-kuma style heartbeat monitors).
func checkPush(ctx context.Context, rec *core.Record) (bool, int64, string) {
	raw := strings.TrimSpace(rec.GetString("last_ping"))
	if raw == "" {
		return false, 0, "No heartbeat received yet (waiting for first push)"
	}
	last, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return false, 0, "Invalid last heartbeat timestamp"
	}
	interval := rec.GetInt("interval")
	if interval <= 0 {
		interval = defaultIntervalSec
	}
	// allow one interval of grace so a delayed push doesn't flap
	elapsed := time.Since(last)
	if elapsed <= time.Duration(interval)*time.Second {
		return true, elapsed.Milliseconds(), "Last heartbeat " + last.Format(time.RFC3339)
	}
	return false, 0, fmt.Sprintf("No heartbeat for %s", elapsed.Round(time.Second))
}

// checkHTTP performs an HTTP(S) check.
func checkHTTP(ctx context.Context, rec *core.Record) (bool, int64, string) {
	httpClientOnce.Do(initHTTPClients)

	target := strings.TrimSpace(rec.GetString("url"))
	if target == "" {
		return false, 0, "No URL provided"
	}
	// prepend scheme if missing
	if !strings.Contains(target, "://") {
		if rec.GetBool("secure") {
			target = "https://" + target
		} else {
			target = "http://" + target
		}
	}

	method := strings.ToUpper(strings.TrimSpace(rec.GetString("method")))
	if method == "" {
		method = http.MethodGet
	}

	req, err := http.NewRequestWithContext(ctx, method, target, nil)
	if err != nil {
		return false, 0, "Invalid URL"
	}

	// custom headers (values stored as strings in the json field)
	var headers map[string]any
	if err := rec.UnmarshalJSONField("headers", &headers); err == nil {
		for k, v := range headers {
			if s, ok := v.(string); ok && s != "" {
				req.Header.Set(k, s)
			}
		}
	}

	client := secureClient
	if !rec.GetBool("secure") && strings.HasPrefix(target, "https://") {
		client = insecureClient
	}

	start := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		return false, elapsed.Milliseconds(), err.Error()
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))

	// expected status: empty means 2xx/3xx, otherwise a status code prefix (e.g. "20")
	expectedStatus := strings.TrimSpace(rec.GetString("expected_status"))
	statusOK := true
	if expectedStatus == "" {
		statusOK = resp.StatusCode >= 200 && resp.StatusCode < 400
	} else {
		statusOK = strings.HasPrefix(strconv.Itoa(resp.StatusCode), expectedStatus)
	}
	if !statusOK {
		return false, elapsed.Milliseconds(), fmt.Sprintf("Status %d", resp.StatusCode)
	}

	// optional JSON query path (uptime-kuma style, e.g. ".status" or ".data.msg").
	// When set, the expected value is compared against the resolved JSON value
	// instead of searching the raw body.
	jsonPath := strings.TrimSpace(rec.GetString("json_query"))
	expectedBody := strings.TrimSpace(rec.GetString("expected_body"))
	if jsonPath != "" {
		value, err := jsonQuery(body, jsonPath)
		if err != nil {
			return false, elapsed.Milliseconds(), "JSON query failed: " + err.Error()
		}
		if expectedBody != "" && fmt.Sprint(value) != expectedBody {
			return false, elapsed.Milliseconds(), fmt.Sprintf("JSON value %q != expected %q", value, expectedBody)
		}
	} else if expectedBody != "" && !strings.Contains(string(body), expectedBody) {
		return false, elapsed.Milliseconds(), "Expected body not found"
	}

	// optional certificate expiry check for https monitors
	if rec.GetBool("check_cert") {
		u, err := url.Parse(target)
		if err == nil && u.Scheme == "https" && u.Hostname() != "" {
			port := 443
			if p := u.Port(); p != "" {
				port, _ = strconv.Atoi(p)
			}
			ok, _, msg := checkCertExpiry(ctx, u.Hostname(), port)
			if !ok {
				return false, elapsed.Milliseconds(), msg
			}
		}
	}

	return true, elapsed.Milliseconds(), ""
}

// checkTCP performs a TCP port check.
func checkTCP(ctx context.Context, rec *core.Record) (bool, int64, string) {
	host, port := monitorTarget(rec)
	if host == "" || port == 0 {
		return false, 0, "No host or port provided"
	}

	start := time.Now()
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	elapsed := time.Since(start)
	if err != nil {
		return false, elapsed.Milliseconds(), err.Error()
	}
	conn.Close()
	return true, elapsed.Milliseconds(), ""
}

// checkPing performs an ICMP echo check.
func checkPing(ctx context.Context, rec *core.Record) (bool, int64, string) {
	host, _ := monitorTarget(rec)
	if host == "" {
		return false, 0, "No host provided"
	}

	// resolve to IP addresses and ping each one
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return false, 0, "Could not resolve " + host
	}

	var lastErr string
	start := time.Now()
	for _, ip := range ips {
		up, elapsed, msg := pingIP(ctx, ip.String())
		if up {
			return true, elapsed, ""
		}
		if msg != "" {
			lastErr = msg
		}
	}
	return false, time.Since(start).Milliseconds(), lastErr
}

// pingConn opens an ICMP connection to the given IP. It prefers the unprivileged
// UDP pseudo-socket (works in containers) and falls back to a raw socket.
func pingConn(ctx context.Context, ip string) (net.PacketConn, error) {
	network := "udp4"
	if strings.Contains(ip, ":") {
		network = "udp6"
	}
	// unprivileged ping (ICMP over UDP) — works without root on Linux/Darwin
	if conn, err := icmp.ListenPacket(network, ""); err == nil {
		return conn, nil
	}
	// fallback: raw socket (requires root/CAP_NET_RAW)
	rawNetwork := "ip4:icmp"
	if strings.Contains(ip, ":") {
		rawNetwork = "ip6:ipv6-icmp"
	}
	return icmp.ListenPacket(rawNetwork, "")
}

// pingIP sends a single ICMP echo request to the given IP address and waits for the reply.
func pingIP(ctx context.Context, ip string) (bool, int64, string) {
	isIPv6 := strings.Contains(ip, ":")

	conn, err := pingConn(ctx, ip)
	if err != nil {
		return false, 0, "ICMP unavailable: " + err.Error()
	}
	defer conn.Close()

	echo := &icmp.Echo{ID: int(pingID), Seq: 1, Data: []byte("beszel")}
	var proto int
	var msgType icmp.Type
	if isIPv6 {
		proto = 58
		msgType = ipv6.ICMPTypeEchoRequest
	} else {
		proto = 1
		msgType = ipv4.ICMPTypeEcho
	}

	b, err := (&icmp.Message{Type: msgType, Body: echo}).Marshal(nil)
	if err != nil {
		return false, 0, err.Error()
	}
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	if _, err := conn.WriteTo(b, &net.IPAddr{IP: net.ParseIP(ip)}); err != nil {
		return false, 0, err.Error()
	}

	buf := make([]byte, 1500)
	start := time.Now()
	for {
		n, _, err := conn.ReadFrom(buf)
		if err != nil {
			return false, time.Since(start).Milliseconds(), err.Error()
		}
		reply, err := icmp.ParseMessage(proto, buf[:n])
		if err != nil || reply == nil {
			continue
		}
		if body, ok := reply.Body.(*icmp.Echo); ok && body.ID == int(pingID) {
			return true, time.Since(start).Milliseconds(), ""
		}
	}
}

// jsonQuery resolves a simple dot-path like ".status" or ".data.items[0].name"
// against the decoded JSON body and returns the final value.
func jsonQuery(body []byte, path string) (any, error) {
	path = strings.TrimSpace(path)
	path = strings.TrimPrefix(path, "$")
	path = strings.TrimPrefix(path, ".")
	if path == "" {
		return nil, fmt.Errorf("empty json path")
	}

	var root any
	if err := json.Unmarshal(body, &root); err != nil {
		return nil, err
	}

	current := root
	for _, part := range splitJSONPath(path) {
		if part == "" {
			continue
		}
		// split key and optional array index
		key := part
		index := -1
		if i := strings.Index(part, "["); i >= 0 && strings.HasSuffix(part, "]") {
			key = part[:i]
			n, err := strconv.Atoi(part[i+1 : len(part)-1])
			if err != nil {
				return nil, fmt.Errorf("invalid array index in %q", part)
			}
			index = n
		}
		if key != "" {
			m, ok := current.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("path segment %q is not an object", key)
			}
			val, ok := m[key]
			if !ok {
				return nil, fmt.Errorf("key %q not found", key)
			}
			current = val
		}
		if index >= 0 {
			arr, ok := current.([]any)
			if !ok {
				return nil, fmt.Errorf("expected array at index %d", index)
			}
			if index >= len(arr) {
				return nil, fmt.Errorf("index %d out of range", index)
			}
			current = arr[index]
		}
	}
	return current, nil
}

// splitJSONPath splits "a.b[0].c" into ["a" "b[0]" "c"].
func splitJSONPath(path string) []string {
	var parts []string
	var buf strings.Builder
	depth := 0
	for _, r := range path {
		switch {
		case r == '[':
			depth++
			buf.WriteRune(r)
		case r == ']':
			depth--
			buf.WriteRune(r)
		case r == '.' && depth == 0:
			parts = append(parts, buf.String())
			buf.Reset()
		default:
			buf.WriteRune(r)
		}
	}
	parts = append(parts, buf.String())
	return parts
}
