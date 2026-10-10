import AppKit
import WebKit

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let fixture = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
let output = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
final class Assets: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url, url.host == "bundle", !url.path.contains(".."),
      let data = try? Data(contentsOf: root.appendingPathComponent(url.path)) else {
      task.didFailWithError(URLError(.fileDoesNotExist)); return
    }
    let mime = ["html":"text/html", "js":"text/javascript", "css":"text/css", "wasm":"application/wasm"][url.pathExtension] ?? "application/octet-stream"
    task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type":mime,"Access-Control-Allow-Origin":"*"])!)
    task.didReceive(data); task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
final class Bridge: NSObject, WKScriptMessageHandler {
  var web: WKWebView!
  var checked = false
  func fail(_ message: String) { print(message); exit(1) }
  func snapshotTheme(_ index: Int) {
    let variants = [("light", false, false), ("dark", true, false), ("hc-light", false, true), ("hc-dark", true, true)]
    if index == variants.count { exit(0) }
    let (name, dark, contrast) = variants[index]
    web.callAsyncJavaScript("""
    const input = \(String(data: fixture, encoding: .utf8)!);
    input.dark = \(dark); input.contrast = \(contrast);
    window.serviceCanvas.update(input);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const tools = document.querySelector('.tessiven-canvas-tools').getBoundingClientRect();
    const overview = document.querySelector('.floe-graph__minimap').getBoundingClientRect();
    for (const element of document.querySelectorAll('.tessiven-canvas-tools button, .tessiven-canvas-tools select')) {
      const box = element.getBoundingClientRect();
      if (box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight) throw Error('Native control outside viewport');
    }
    if(tools.right > overview.left && tools.bottom > overview.top && overview.bottom > tools.top) throw Error('Native tools overlap overview');
    return '\(name)';
    """, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .failure(let error): self.fail(String(describing: error))
      case .success:
        self.web.takeSnapshot(with: nil) { image, error in
          guard let image, let tiff = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else {
            self.fail("No native screenshot: \(String(describing: error))"); return
          }
          try! png.write(to: output.appendingPathComponent("native-\(name).png"))
          self.snapshotTheme(index + 1)
        }
      }
    }
  }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String:Any], let type = body["type"] as? String else { return }
    if type == "error" { fail("Native canvas reported error") }
    if type == "ready" {
      let input = String(data: fixture, encoding: .utf8)!
      web.evaluateJavaScript("window.serviceCanvas.update(\(input))") { _, error in if let error { self.fail(String(describing:error)) } }
    }
    if type == "rendered", !checked {
      checked = true
      web.callAsyncJavaScript("""
      const until = async read => { for(let i=0;i<300;i++){if(read())return;await new Promise(r=>setTimeout(r,50));}throw Error('Native canvas state timed out'); };
      const nodes = () => document.querySelectorAll('.tessiven-node').length;
      const count=nodes(); if(!count) throw Error('No native nodes');
      const button = label => [...document.querySelectorAll('button')].find(b=>b.textContent===label);
      button('Collapse all').click(); await until(()=>nodes()===0 && !document.querySelector('[aria-label="Arranging canvas"]'));
      button('Expand all').click(); await until(()=>nodes()>0 && !document.querySelector('[aria-label="Arranging canvas"]'));
      const inventory = () => document.querySelector('[data-group-id="g-master"][data-node-id="n-master-a"]').querySelectorAll('.tessiven-service').length;
      const complete = inventory(); if(complete <= 1) throw Error('Native fixture has no mixed inventory');
      const scope=document.querySelector('select'); scope.value='group'; scope.dispatchEvent(new Event('change',{bubbles:true}));
      await until(()=>inventory()===1 && !document.querySelector('[aria-label="Arranging canvas"]'));
      scope.value='all'; scope.dispatchEvent(new Event('change',{bubbles:true})); await until(()=>inventory()===complete && !document.querySelector('[aria-label="Arranging canvas"]'));
      const tools=document.querySelector('.tessiven-canvas-tools').getBoundingClientRect(), overview=document.querySelector('.floe-graph__minimap').getBoundingClientRect();
      if(tools.right>overview.left && tools.bottom>overview.top && overview.bottom>tools.top) throw Error('Native tools overlap overview');
      if(document.querySelector('[role="alert"]')) throw Error('Native canvas alert');
      return {nodes:count,overviewPaths:document.querySelectorAll('.floe-graph__minimap path').length,scope:scope.value,allServices:complete,groupServices:1};
      """, arguments: [:], in: nil, in: .page) { result in
        switch result {
        case .failure(let error): self.fail(String(describing:error))
        case .success(let value):
          print(value)
          self.snapshotTheme(0)
        }
      }
    }
  }
}
let config=WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.setURLSchemeHandler(Assets(),forURLScheme:"redeven-canvas")
let bridge=Bridge()
config.userContentController.add(bridge,name:"canvas")
let web=WKWebView(frame:NSRect(x:0,y:0,width:480,height:360),configuration:config)
bridge.web=web
let window=NSWindow(contentRect:web.frame,styleMask:[.titled],backing:.buffered,defer:false)
window.contentView=web; window.orderFront(nil)
web.load(URLRequest(url:URL(string:"redeven-canvas://bundle/index.html")!))
DispatchQueue.main.asyncAfter(deadline:.now()+30){print("Native canvas deadline exceeded");exit(1)}
application.run()
