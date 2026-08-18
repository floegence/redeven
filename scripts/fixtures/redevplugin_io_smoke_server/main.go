package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync/atomic"

	"github.com/gorilla/websocket"
)

type counters struct{ httpActive, httpClosed, wsActive, wsClosed, tcpActive, tcpClosed, udpDatagrams uint64 }

var counts counters
var upgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

func isWebSocketUpgrade(request *http.Request) bool {
	return request != nil && strings.EqualFold(strings.TrimSpace(request.Header.Get("Upgrade")), "websocket")
}

func newLocalUIReverseProxy(target *url.URL, publicAuthority, rewriteAuthority string, preserveAuthority bool, diagnostic func(string, ...any)) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(request *http.Request) {
		originalDirector(request)
		request.Header.Set("Accept-Encoding", "identity")
		if !preserveAuthority {
			request.Host = target.Host
			if request.Header.Get("Origin") != "" {
				request.Header.Set("Origin", target.Scheme+"://"+target.Host)
			}
		}
		if diagnostic != nil {
			diagnostic("local UI proxy request method=%s path=%q websocket=%t", request.Method, request.URL.EscapedPath(), isWebSocketUpgrade(request))
		}
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		if diagnostic != nil {
			diagnostic("local UI proxy response method=%s path=%q status=%d websocket=%t", response.Request.Method, response.Request.URL.EscapedPath(), response.StatusCode, response.StatusCode == http.StatusSwitchingProtocols)
		}
		for _, internalAuthority := range []string{target.Host, rewriteAuthority} {
			if internalAuthority != "" {
				response.Header.Set("Location", strings.ReplaceAll(response.Header.Get("Location"), internalAuthority, publicAuthority))
			}
		}
		if !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") || response.Request.URL.Path == "/api/local/direct/connect_artifact" {
			return nil
		}
		body, readErr := io.ReadAll(response.Body)
		if readErr != nil {
			return readErr
		}
		_ = response.Body.Close()
		for _, internalAuthority := range []string{target.Host, rewriteAuthority} {
			if internalAuthority != "" {
				body = bytes.ReplaceAll(body, []byte(internalAuthority), []byte(publicAuthority))
			}
		}
		response.Body = io.NopCloser(bytes.NewReader(body))
		response.ContentLength = int64(len(body))
		response.Header.Set("Content-Length", fmt.Sprint(len(body)))
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, request *http.Request, _ error) {
		if diagnostic != nil {
			diagnostic("local UI proxy upstream failure method=%s path=%q websocket=%t", request.Method, request.URL.EscapedPath(), isWebSocketUpgrade(request))
		}
		http.Error(w, "Local UI proxy upstream unavailable", http.StatusBadGateway)
	}
	return proxy
}

func deterministic(w io.Writer, bytes int64) (string, error) {
	h := sha256.New()
	chunk := make([]byte, 64*1024)
	for i := range chunk {
		chunk[i] = byte(i % 251)
	}
	for left := bytes; left > 0; {
		n := int64(len(chunk))
		if n > left {
			n = left
		}
		if _, err := w.Write(chunk[:n]); err != nil {
			return "", err
		}
		_, _ = h.Write(chunk[:n])
		left -= n
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func main() {
	bind := flag.String("bind", "127.0.0.1", "bind address")
	payloadBytes := flag.Int64("bytes", 64*1024*1024, "deterministic payload size")
	httpPort := flag.Int("http-port", 18080, "HTTP/WebSocket port")
	tcpPort := flag.Int("tcp-port", 18081, "TCP port")
	udpPort := flag.Int("udp-port", 18082, "UDP port")
	localUIProxyPort := flag.Int("local-ui-proxy-port", 0, "optional Local UI reverse proxy port")
	localUITarget := flag.String("local-ui-target", "", "Local UI reverse proxy target")
	localUITrustedBridge := flag.Bool("local-ui-trusted-bridge", false, "preserve the public authority for a trusted Local UI bridge target")
	localUIRewriteAuthority := flag.String("local-ui-rewrite-authority", "", "additional internal Local UI authority to rewrite in non-artifact responses")
	flag.Parse()
	mux := http.NewServeMux()
	mux.HandleFunc("/download", func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddUint64(&counts.httpActive, 1)
		defer func() { atomic.AddUint64(&counts.httpActive, ^uint64(0)); atomic.AddUint64(&counts.httpClosed, 1) }()
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = deterministic(w, *payloadBytes)
	})
	mux.HandleFunc("/upload", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddUint64(&counts.httpActive, 1)
		defer func() { atomic.AddUint64(&counts.httpActive, ^uint64(0)); atomic.AddUint64(&counts.httpClosed, 1) }()
		h := sha256.New()
		n, err := io.Copy(h, r.Body)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		_, _ = fmt.Fprintf(w, `{"bytes":%d,"sha256":"%s"}`, n, hex.EncodeToString(h.Sum(nil)))
	})
	mux.HandleFunc("/hold", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddUint64(&counts.httpActive, 1)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(200)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		<-r.Context().Done()
		atomic.AddUint64(&counts.httpActive, ^uint64(0))
		atomic.AddUint64(&counts.httpClosed, 1)
	})
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		atomic.AddUint64(&counts.wsActive, 1)
		defer func() {
			c.Close()
			atomic.AddUint64(&counts.wsActive, ^uint64(0))
			atomic.AddUint64(&counts.wsClosed, 1)
		}()
		for {
			typ, msg, err := c.ReadMessage()
			if err != nil {
				return
			}
			if err = c.WriteMessage(typ, msg); err != nil {
				return
			}
		}
	})
	mux.HandleFunc("/state", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"http_active": atomic.LoadUint64(&counts.httpActive), "http_closed": atomic.LoadUint64(&counts.httpClosed), "ws_active": atomic.LoadUint64(&counts.wsActive), "ws_closed": atomic.LoadUint64(&counts.wsClosed), "tcp_active": atomic.LoadUint64(&counts.tcpActive), "tcp_closed": atomic.LoadUint64(&counts.tcpClosed), "udp_datagrams": atomic.LoadUint64(&counts.udpDatagrams)})
	})
	httpListener, err := net.Listen("tcp", net.JoinHostPort(*bind, fmt.Sprint(*httpPort)))
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		if err := http.Serve(httpListener, mux); err != nil {
			log.Fatal(err)
		}
	}()
	tcpListener, err := net.Listen("tcp", net.JoinHostPort(*bind, fmt.Sprint(*tcpPort)))
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		for {
			c, e := tcpListener.Accept()
			if e != nil {
				return
			}
			atomic.AddUint64(&counts.tcpActive, 1)
			go func() {
				defer func() {
					c.Close()
					atomic.AddUint64(&counts.tcpActive, ^uint64(0))
					atomic.AddUint64(&counts.tcpClosed, 1)
				}()
				buf := make([]byte, 64*1024)
				for {
					n, e := c.Read(buf)
					if e != nil {
						return
					}
					if _, e = c.Write(buf[:n]); e != nil {
						return
					}
				}
			}()
		}
	}()
	udpConn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP(*bind), Port: *udpPort})
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		buf := make([]byte, 64*1024)
		for {
			n, addr, e := udpConn.ReadFromUDP(buf)
			if e != nil {
				return
			}
			atomic.AddUint64(&counts.udpDatagrams, 1)
			_, _ = udpConn.WriteToUDP(buf[:n], addr)
		}
	}()
	proxyPort := 0
	if *localUIProxyPort > 0 {
		target, parseErr := url.Parse(*localUITarget)
		if parseErr != nil || target.Scheme != "http" || target.Host == "" {
			log.Fatal("invalid Local UI proxy target")
		}
		publicAuthority := net.JoinHostPort("127.0.0.1", fmt.Sprint(*localUIProxyPort))
		proxy := newLocalUIReverseProxy(target, publicAuthority, *localUIRewriteAuthority, *localUITrustedBridge, log.Printf)
		proxyListener, listenErr := net.Listen("tcp", net.JoinHostPort(*bind, fmt.Sprint(*localUIProxyPort)))
		if listenErr != nil {
			log.Fatal(listenErr)
		}
		proxyPort = proxyListener.Addr().(*net.TCPAddr).Port
		go func() {
			if err := http.Serve(proxyListener, proxy); err != nil {
				log.Fatal(err)
			}
		}()
	}
	record := map[string]any{"http": httpListener.Addr().(*net.TCPAddr).Port, "ws": httpListener.Addr().(*net.TCPAddr).Port, "tcp": tcpListener.Addr().(*net.TCPAddr).Port, "udp": udpConn.LocalAddr().(*net.UDPAddr).Port, "local_ui_proxy": proxyPort, "pid": 0}
	// WebSocket shares the HTTP listener; the separate fields make the fixture contract explicit.
	if err := json.NewEncoder(os.Stdout).Encode(record); err != nil {
		log.Fatal(err)
	}
	select {}
}
