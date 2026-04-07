// Package uptime performs HTTP/HTTPS/TCP availability checks.
package uptime

import (
	"fmt"
	"net"
	"net/http"
	"time"
)

// CheckResult holds the outcome of a single availability check.
type CheckResult struct {
	Up           bool
	ResponseTime float64 // milliseconds
	StatusCode   int
	Message      string
}

// sharedTransport is reused across all HTTP checks for connection pooling.
var sharedTransport = &http.Transport{
	MaxIdleConns:        100,
	MaxIdleConnsPerHost: 10,
	IdleConnTimeout:     90 * time.Second,
}

// CheckHTTP performs an HTTP or HTTPS GET request and returns the result.
// Redirects are not followed so we capture the initial response code.
func CheckHTTP(rawURL string, timeoutSecs int) CheckResult {
	client := &http.Client{
		Timeout:   time.Duration(timeoutSecs) * time.Second,
		Transport: sharedTransport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	start := time.Now()
	resp, err := client.Get(rawURL)
	elapsed := float64(time.Since(start).Milliseconds())

	if err != nil {
		return CheckResult{Up: false, ResponseTime: elapsed, Message: truncate(err.Error(), 250)}
	}
	defer resp.Body.Close()

	up := resp.StatusCode < 500
	msg := ""
	if !up {
		msg = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return CheckResult{Up: up, ResponseTime: elapsed, StatusCode: resp.StatusCode, Message: msg}
}

// CheckTCP dials a TCP address and returns the result.
func CheckTCP(host string, port int, timeoutSecs int) CheckResult {
	timeout := time.Duration(timeoutSecs) * time.Second
	addr := fmt.Sprintf("%s:%d", host, port)
	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, timeout)
	elapsed := float64(time.Since(start).Milliseconds())
	if err != nil {
		return CheckResult{Up: false, ResponseTime: elapsed, Message: truncate(err.Error(), 250)}
	}
	conn.Close()
	return CheckResult{Up: true, ResponseTime: elapsed}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
