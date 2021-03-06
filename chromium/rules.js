// Stubs so this runs under nodejs. They get overwritten later by util.js
var DBUG = 1;
function log(){};

/**
 * A single rule
 * @param from
 * @param to
 * @constructor
 */
function Rule(from, to) {
  //this.from = from;
  this.to = to;
  this.from_c = new RegExp(from);
}

/**
 * Regex-Compile a pattern
 * @param pattern The pattern to compile
 * @constructor
 */
function Exclusion(pattern) {
  //this.pattern = pattern;
  this.pattern_c = new RegExp(pattern);
}

/**
 * Generates a CookieRule
 * @param host The host regex to compile
 * @param cookiename The cookie name Regex to compile
 * @constructor
 */
function CookieRule(host, cookiename) {
  this.host = host;
  this.host_c = new RegExp(host);
  this.name = cookiename;
  this.name_c = new RegExp(cookiename);
}

/**
 *A collection of rules
 * @param set_name The name of this set
 * @param default_state activity state
 * @param note Note will be displayed in popup
 * @constructor
 */
function RuleSet(set_name, default_state, note) {
  this.name = set_name;
  this.rules = [];
  this.exclusions = null;
  this.cookierules = null;
  this.active = default_state;
  this.default_state = default_state;
  this.note = note;
}

RuleSet.prototype = {
  /**
   * Check if a URI can be rewritten and rewrite it
   * @param urispec The uri to rewrite
   * @returns {*} null or the rewritten uri
   */
  apply: function(urispec) {
    var returl = null;
    // If we're covered by an exclusion, go home
    if (this.exclusions !== null) {
      for (var i = 0; i < this.exclusions.length; ++i) {
        if (this.exclusions[i].pattern_c.test(urispec)) {
          log(DBUG, "excluded uri " + urispec);
          return null;
        }
      }
    }

    // Okay, now find the first rule that triggers
    for(var i = 0; i < this.rules.length; ++i) {
      returl = urispec.replace(this.rules[i].from_c,
                               this.rules[i].to);
      if (returl != urispec) {
        return returl;
      }
    }
    return null;
  }

};

/**
 * Initialize Rule Sets
 * @param userAgent The browser's user agent
 * @param cache a cache object (lru)
 * @param ruleActiveStates default state for rules
 * @constructor
 */
function RuleSets(userAgent, cache, ruleActiveStates) {
  // Load rules into structure
  var t1 = new Date().getTime();
  this.targets = {};
  this.userAgent = userAgent;

  // A cache for potentiallyApplicableRulesets
  // Size chosen /completely/ arbitrarily.
  this.ruleCache = new cache(1000);

  // A cache for cookie hostnames.
  this.cookieHostCache = new cache(100);

  // A hash of rule name -> active status (true/false).
  this.ruleActiveStates = ruleActiveStates;
}


RuleSets.prototype = {
  /**
   * Iterate through data XML and load rulesets
   */
  addFromXml: function(ruleXml) {
    var sets = ruleXml.getElementsByTagName("ruleset");
    for (var i = 0; i < sets.length; ++i) {
      try {
        this.parseOneRuleset(sets[i]);
      } catch (e) {
        log(WARN, 'Error processing ruleset:' + e);
      }
    }
  },

  /**
   * Return the RegExp for the local platform
   */
  localPlatformRegexp: (function() {
    var isOpera = /(?:OPR|Opera)[\/\s](\d+)(?:\.\d+)/.test(this.userAgent);
    if (isOpera && isOpera.length === 2 && parseInt(isOpera[1]) < 23) {
      // Opera <23 does not have mixed content blocking
      log(DBUG, 'Detected that we are running Opera < 23');
      return new RegExp("chromium|mixedcontent");
    } else {
      log(DBUG, 'Detected that we are running Chrome/Chromium');
      return new RegExp("chromium");
    }
  })(),

  /**
   * Load a user rule
   * @param params
   * @returns {boolean}
   */
  addUserRule : function(params) {
    log(INFO, 'adding new user rule for ' + JSON.stringify(params));
    var new_rule_set = new RuleSet(params.host, true, "user rule");
    var new_rule = new Rule(params.urlMatcher, params.redirectTo);
    new_rule_set.rules.push(new_rule);
    if (!(params.host in this.targets)) {
      this.targets[params.host] = [];
    }
    this.ruleCache.remove(params.host);
    // TODO: maybe promote this rule?
    this.targets[params.host].push(new_rule_set);
    if (new_rule_set.name in this.ruleActiveStates) {
      new_rule_set.active = (this.ruleActiveStates[new_rule_set.name] == "true");
    }
    log(INFO, 'done adding rule');
    return true;
  },

  /**
   * Does the loading of a ruleset.
   * @param ruletag The whole <ruleset> tag to parse
   */
  parseOneRuleset: function(ruletag) {
    var default_state = true;
    var note = "";
    var default_off = ruletag.getAttribute("default_off");
    if (default_off) {
      default_state = false;
      note += default_off + "\n";
    }

    // If a ruleset declares a platform, and we don't match it, treat it as
    // off-by-default
    var platform = ruletag.getAttribute("platform");
    if (platform) {
      if (platform.search(this.localPlatformRegexp) == -1) {
        default_state = false;
      }
      note += "Platform(s): " + platform + "\n";
    }

    var rule_set = new RuleSet(ruletag.getAttribute("name"),
                               default_state,
                               note.trim());

    // Read user prefs
    if (rule_set.name in this.ruleActiveStates) {
      rule_set.active = (this.ruleActiveStates[rule_set.name] == "true");
    }

    var rules = ruletag.getElementsByTagName("rule");
    for(var j = 0; j < rules.length; j++) {
      rule_set.rules.push(new Rule(rules[j].getAttribute("from"),
                                    rules[j].getAttribute("to")));
    }

    var exclusions = ruletag.getElementsByTagName("exclusion");
    if (exclusions.length > 0) {
      rule_set.exclusions = [];
      for (var j = 0; j < exclusions.length; j++) {
        rule_set.exclusions.push(
            new Exclusion(exclusions[j].getAttribute("pattern")));
      }
    }

    var cookierules = ruletag.getElementsByTagName("securecookie");
    if (cookierules.length > 0) {
      rule_set.cookierules = [];
      for(var j = 0; j < cookierules.length; j++) {
        rule_set.cookierules.push(
            new CookieRule(cookierules[j].getAttribute("host"),
                cookierules[j].getAttribute("name")));
      }
    }

    var targets = ruletag.getElementsByTagName("target");
    for(var j = 0; j < targets.length; j++) {
       var host = targets[j].getAttribute("host");
       if (!(host in this.targets)) {
         this.targets[host] = [];
       }
       this.targets[host].push(rule_set);
    }
  },

  /**
   * Insert any elements from fromList into intoList, if they are not
   * already there.  fromList may be null.
   * @param intoList
   * @param fromList
   */
  setInsert: function(intoList, fromList) {
    if (!fromList) return;
    for (var i = 0; i < fromList.length; i++)
      if (intoList.indexOf(fromList[i]) == -1)
        intoList.push(fromList[i]);
  },

  /**
   * Return a list of rulesets that apply to this host
   * @param host The host to check
   * @returns {*} (empty) list
   */
  potentiallyApplicableRulesets: function(host) {
    // Have we cached this result? If so, return it!
    var cached_item = this.ruleCache.get(host);
    if (cached_item !== undefined) {
        log(DBUG, "Ruleset cache hit for " + host + " items:" + cached_item.length);
        return cached_item;
    }
    log(DBUG, "Ruleset cache miss for " + host);

    var tmp;
    var results = [];
    if (this.targets[host]) {
      // Copy the host targets so we don't modify them.
      results = this.targets[host].slice();
    }

    // Replace each portion of the domain with a * in turn
    var segmented = host.split(".");
    for (var i = 0; i < segmented.length; ++i) {
      tmp = segmented[i];
      segmented[i] = "*";
      this.setInsert(results, this.targets[segmented.join(".")]);
      segmented[i] = tmp;
    }
    // now eat away from the left, with *, so that for x.y.z.google.com we
    // check *.z.google.com and *.google.com (we did *.y.z.google.com above)
    for (var i = 2; i <= segmented.length - 2; ++i) {
      t = "*." + segmented.slice(i,segmented.length).join(".");
      this.setInsert(results, this.targets[t]);
    }
    log(DBUG,"Applicable rules for " + host + ":");
    if (results.length == 0)
      log(DBUG, "  None");
    else
      for (var i = 0; i < results.length; ++i)
        log(DBUG, "  " + results[i].name);

    // Insert results into the ruleset cache
    this.ruleCache.set(host, results);
    return results;
  },

  /**
   * Check to see if the Cookie object c meets any of our cookierule criteria for being marked as secure.
   * knownHttps is true if the context for this cookie being set is known to be https.
   * @param cookie The cookie to test
   * @param knownHttps Is the context for setting this cookie is https ?
   * @returns {*} ruleset or null
   */
  shouldSecureCookie: function(cookie, knownHttps) {
    var hostname = cookie.domain;
    // cookie domain scopes can start with .
    while (hostname.charAt(0) == ".")
      hostname = hostname.slice(1);

    if (!knownHttps && !this.safeToSecureCookie(hostname)) {
        return null;
    }

    var rs = this.potentiallyApplicableRulesets(hostname);
    for (var i = 0; i < rs.length; ++i) {
      var ruleset = rs[i];
      if (ruleset.cookierules !== null && ruleset.active) {
        for (var j = 0; j < ruleset.cookierules.length; j++) {
          var cr = ruleset.cookierules[j];
          if (cr.host_c.test(cookie.domain) && cr.name_c.test(cookie.name)) {
            return ruleset;
          }
        }
      }
    }
    return null;
  },

  /**
   * Check if it is secure to secure the cookie (=patch the secure flag in).
   * @param domain The domain of the cookie
   * @returns {*} true or false
   */
  safeToSecureCookie: function(domain) {
    // Check if the domain might be being served over HTTP.  If so, it isn't
    // safe to secure a cookie!  We can't always know this for sure because
    // observing cookie-changed doesn't give us enough context to know the
    // full origin URI.

    // First, if there are any redirect loops on this domain, don't secure
    // cookies.  XXX This is not a very satisfactory heuristic.  Sometimes we
    // would want to secure the cookie anyway, because the URLs that loop are
    // not authenticated or not important.  Also by the time the loop has been
    // observed and the domain blacklisted, a cookie might already have been
    // flagged as secure.

    if (domain in domainBlacklist) {
      log(INFO, "cookies for " + domain + "blacklisted");
      return false;
    }
    var cached_item = this.cookieHostCache.get(domain);
    if (cached_item !== undefined) {
        log(DBUG, "Cookie host cache hit for " + domain);
        return cached_item;
    }
    log(DBUG, "Cookie host cache miss for " + domain);

    // If we passed that test, make up a random URL on the domain, and see if
    // we would HTTPSify that.

    var nonce_path = "/" + Math.random().toString();
    var test_uri = "http://" + domain + nonce_path + nonce_path;

    log(INFO, "Testing securecookie applicability with " + test_uri);
    var rs = this.potentiallyApplicableRulesets(domain);
    for (var i = 0; i < rs.length; ++i) {
      if (!rs[i].active) continue;
      if (rs[i].apply(test_uri)) {
        log(INFO, "Cookie domain could be secured.");
        this.cookieHostCache.set(domain, true);
        return true;
      }
    }
    log(INFO, "Cookie domain could NOT be secured.");
    this.cookieHostCache.set(domain, false);
    return false;
  },

  /**
   * Rewrite an URI
   * @param urispec The uri to rewrite
   * @param host The host of this uri
   * @returns {*} the new uri or null
   */
  rewriteURI: function(urispec, host) {
    var newuri = null;
    var rs = this.potentiallyApplicableRulesets(host);
    for(var i = 0; i < rs.length; ++i) {
      if (rs[i].active && (newuri = rs[i].apply(urispec)))
        return newuri;
    }
    return null;
  }
};

// Export for HTTPS Rewriter if applicable.
if (typeof exports != 'undefined') {
  exports.RuleSets = RuleSets;
}
