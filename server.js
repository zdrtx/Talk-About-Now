HOST = null; // localhost
PORT = 8001;

// when the daemon started
var starttime = (new Date()).getTime();

var mem = process.memoryUsage();
// every 10 seconds poll for the memory.
setInterval(function () {
  mem = process.memoryUsage();
}, 10*1000);


var fu = require("./fu"),
    sys = require("sys"),
    url = require("url"),
    qs = require("querystring");

var MESSAGE_BACKLOG = 200,
    SESSION_TIMEOUT = 60 * 1000;

var channel = new function () {
  var messages = [],
      callbacks = [];

  this.appendMessage = function (name, type, text) {
    var m = { name: name
            , type: type // "msg", "join", "part"
            , text: text
            , profile: profile
            , pic: pic
            , timestamp: (new Date()).getTime()
            };

    switch (type) {
      case "msg":
        sys.puts("<" + name + "> " + text);
        break;
      case "join":
        sys.puts(name + " join");
        break;
      case "part":
        sys.puts(name + " part");
        break;
    }

    messages.push( m );

    while (callbacks.length > 0) {
      callbacks.shift().callback([m]);
    }

    while (messages.length > MESSAGE_BACKLOG)
      messages.shift();
  };

  this.query = function (since, callback) {
    var matching = [];
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (message.timestamp > since)
        matching.push(message)
    }

    if (matching.length != 0) {
      callback(matching);
    } else {
      callbacks.push({ timestamp: new Date(), callback: callback });
    }
  };

  // clear old callbacks
  // they can hang around for at most 30 seconds.
  setInterval(function () {
    var now = new Date();
    while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
      callbacks.shift().callback([]);
    }
  }, 3000);
};

var sessions = {};

function createSession (user) {

  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.id == user.id) return null;
  }

  var session = { 
    name: user.name, 
    id: user.id,
	profile: user.profile,
	pic: user.pic,
    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      channel.appendMessage(session.name, "part");
      delete sessions[session.id];
    }
  };

  sessions[session.id] = session;
  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];

    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }
}, 1000);

fu.listen(Number(process.env.PORT || PORT), HOST);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/style.css", fu.staticHandler("style.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));


fu.get("/who", function (req, res) {
  var names = [];
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];
    names.push(session.name);
  }
  res.simpleJSON(200, { names: names
                      , rss: mem.rss
                      });
});

fu.get("/join", function (req, res) {
	var user = qs.parse(url.parse(req.url).query);
  if (user.id == null) {
    res.simpleJSON(400, {error: "Bad login."});
    return;
  }
  var session = createSession(user);
  console.log(session);
  if (session == null) {
    res.simpleJSON(400, {error: "Already logged in?"});
    return;
  }

  //sys.puts("connection: " + name + "@" + res.connection.remoteAddress);

  channel.appendMessage(session.name, "join");
  res.simpleJSON(200, { id: user.id
                      , name: user.name
                      , rss: mem.rss
                      , starttime: starttime
                      });
});

fu.get("/part", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;

  if (id && sessions[id]) {
    session = sessions[id];
    session.destroy();
  }
  res.simpleJSON(200, { rss: mem.rss });
});

fu.get("/recv", function (req, res) {
  if (!qs.parse(url.parse(req.url).query).since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }
  var id = qs.parse(url.parse(req.url).query).id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.poke();
  }

  var since = parseInt(qs.parse(url.parse(req.url).query).since, 10);

  channel.query(since, function (messages) {
    if (session) session.poke();
    res.simpleJSON(200, { messages: messages, rss: mem.rss });
  });
});

fu.get("/send", function (req, res) {
  var id = qs.parse(url.parse(req.url).query).id;
  var text = qs.parse(url.parse(req.url).query).text;

  var session = sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return;
  }

  session.poke();

  channel.appendMessage(session.name, "msg", text, session.profile);
  res.simpleJSON(200, { rss: mem.rss });
});
