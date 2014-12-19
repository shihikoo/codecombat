// Evaluate help videos styles A/B test

// Usage:
// mongo <address>:<port>/<database> <script file> -u <username> -p <password>

// What do we want to know?
// For a given style:
// - Video completion rates (Not too interesting unless each level has all styles available)
// - Video completion rates, per-level too
// - Watched another video
// - Level completion rates
// - Subscription coversion totals
// TODO: The rest
// - How many people who start a level click the help button, and which one?
//    - Need a hard start date when the help button presented


// 12:42am 12/18/14 PST - Intial production deploy completed
var testStartDate = '2014-12-18T08:42:00.000Z';
// 12:29pm 12/18/14 PST - 2nd deploy w/ originals for dungeons-of-kithgard and second-kithmaze
// TODO: move this date up to avoid prod deploy transitional data messing with us.
// testStartDate = '2014-12-18T20:29:00.000Z';
testStartDate = '2014-12-18T22:29:00.000Z';

function printVideoCompletionRates() {
  print("Querying for help video events...");
  var videosCursor = db['analytics.log.events'].find({
    $and: [
      {"created": { $gte: ISODate(testStartDate)}},
      {$or : [
        {"event": "Start help video"},
        {"event": "Finish help video"}
        ]}
      ]
    });

  print("Building video progression data...");
  // Build: <style><level><userID><event> counts
  var videoProgression = {};
  while (videosCursor.hasNext()) {
    var doc = videosCursor.next();
    var userID = doc.user.valueOf();
    var levelID = doc.properties.level;
    var style = doc.properties.style;
    var event = doc.event;
    if (!videoProgression[style]) videoProgression[style] = {};
    if (!videoProgression[style][levelID]) videoProgression[style][levelID] = {};
    if (!videoProgression[style][levelID][userID]) videoProgression[style][levelID][userID] = {};
    if (!videoProgression[style][levelID][userID][event]) videoProgression[style][levelID][userID][event] = 0;
    videoProgression[style][levelID][userID][event]++;
  }

  // Overall per-style

  print("Counting start/finish events per-style...");
  // Calculate overall video style completion rates, agnostic of level
  // Build: <style><event>{<starts>, <finishes>}
  var styleCompletionCounts = {}
  for (style in videoProgression) {
    styleCompletionCounts[style] = {};
    for (levelID in videoProgression[style]) {
      for (userID in videoProgression[style][levelID]) {
        for (event in videoProgression[style][levelID][userID]) {
          if (!styleCompletionCounts[style][event]) styleCompletionCounts[style][event] = 0;
          styleCompletionCounts[style][event] += videoProgression[style][levelID][userID][event];
        }
      }
    }
  }

  print("Sorting per-style completion rates...");
  var styleCompletionRates = [];
  for (style in styleCompletionCounts) {
    var started = 0;
    var finished = 0;
    for (event in styleCompletionCounts[style]) {
      if (event === "Start help video") started += styleCompletionCounts[style][event];
      else if (event === "Finish help video") finished += styleCompletionCounts[style][event];
      else throw new Error("Unknown event " + event);
    }
    var data = {
      style: style,
      started: started,
      finished: finished
    };
    if (finished > 0) data['rate'] = finished / started * 100;
    styleCompletionRates.push(data);
  }
  styleCompletionRates.sort(function(a,b) {return b['rate'] && a['rate'] ? b.rate - a.rate : 0;});

  print("Overall per-style completion rates:");
  for (var i = 0; i < styleCompletionRates.length; i++) {
    var item = styleCompletionRates[i];
    var msg = item.style + (item.style === 'edited' ? "\t\t" : "\t") + item.started + "\t" + item.finished;
    if (item['rate']) msg += "\t" + item.rate + "%";
    print(msg);
  }

  // Style completion rates per-level

  print("Counting start/finish events per-level and style...");
  var styleLevelCompletionCounts = {}
  for (style in videoProgression) {
    for (levelID in videoProgression[style]) {
      if (!styleLevelCompletionCounts[levelID]) styleLevelCompletionCounts[levelID] = {};
      if (!styleLevelCompletionCounts[levelID][style]) styleLevelCompletionCounts[levelID][style] = {};
      for (userID in videoProgression[style][levelID]) {
        for (event in videoProgression[style][levelID][userID]) {
          if (!styleLevelCompletionCounts[levelID][style][event]) styleLevelCompletionCounts[levelID][style][event] = 0;
          styleLevelCompletionCounts[levelID][style][event] += videoProgression[style][levelID][userID][event];
        }
      }
    }
  }

  print("Sorting per-level completion rates...");
  var styleLevelCompletionRates = [];
  for (levelID in styleLevelCompletionCounts) {
    for (style in styleLevelCompletionCounts[levelID]) {
      var started = 0;
      var finished = 0;
      for (event in styleLevelCompletionCounts[levelID][style]) {
        if (event === "Start help video") started += styleLevelCompletionCounts[levelID][style][event];
        else if (event === "Finish help video") finished += styleLevelCompletionCounts[levelID][style][event];
        else throw new Error("Unknown event " + event);
      }
      var data = {
        level: levelID,
        style: style,
        started: started,
        finished: finished
      };
      if (finished > 0) data['rate'] = finished / started * 100;
      styleLevelCompletionRates.push(data);
    }
  }
  styleLevelCompletionRates.sort(function(a,b) {
    if (a.level !== b.level) {
      if (a.level < b.level) return -1;
      else return 1;
    }
    return b['rate'] && a['rate'] ? b.rate - a.rate : 0;
  });

  print("Per-level style completion rates:");
  for (var i = 0; i < styleLevelCompletionRates.length; i++) {
    var item = styleLevelCompletionRates[i];
    var msg = item.level + "\t" + item.style + (item.style === 'edited' ? "\t\t" : "\t") + item.started + "\t" + item.finished;
    if (item['rate']) msg += "\t" + item.rate + "%";
    print(msg);
  }
}

function printWatchedAnotherVideoRates() {
  // How useful is a style/level in yielding more video starts
  // Algorithm:
  // 1. Fetch all start/finish video events after test start date
  // 2. Create a per-userID dictionary of user event history arrays
  // 3. Sort each user event history array in ascending order.  Now we have a video watching history, per-user.
  // 4. Walk through each user's history
  //    a. Increment global count for level/style/event, for each level/style event in past history.
  //    b. Save current entry in the past history.
  // 5. Sort by ascending level name, descending started count

  // TODO: only attribute one start/finish per level to a user?

  print("Querying for help video events...");
  var videosCursor = db['analytics.log.events'].find({
    $and: [
      {"created": { $gte: ISODate(testStartDate)}},
      {$or : [
        {"event": "Start help video"},
        {"event": "Finish help video"}
        ]}
      ]
    });

  print("Building per-user video progression data...");
  // Find video progression per-user
  // Build: <userID>[sorted style/event/level/date events]
  var videoProgression = {};
  while (videosCursor.hasNext()) {
    var doc = videosCursor.next();
    var event = doc.event;
    var userID = doc.user.valueOf();
    var created = doc.created
    var levelID = doc.properties.level;
    var style = doc.properties.style;

    if (!videoProgression[userID]) videoProgression[userID] = [];
    videoProgression[userID].push({
      style: style,
      level: levelID,
      event: event,
      created: created.toISOString()
    })
  }
  // printjson(videoProgression);

  print("Sorting per-user video progression data...");
  for (userID in videoProgression) videoProgression[userID].sort(function (a,b) {return a.created < b.created ? -1 : 1});

  print("Building per-level/style additional watched videos..");
  var additionalWatchedVideos = {};
  for (userID in videoProgression) {

    // Walk user's history, and tally what preceded each historical entry
    var userHistory = videoProgression[userID];
    // printjson(userHistory);
    var previouslyWatched = {};
    for (var i = 0; i < userHistory.length; i++) {

      // Walk previously watched events, and attribute to correct additionally watched entry
      var item = userHistory[i];
      var level = item.level;
      var style = item.style;
      var event = item.event;
      var created = item.created;
      for (previousLevel in previouslyWatched) {
        for (previousStyle in previouslyWatched[previousLevel]) {
          if (previousLevel === level) continue;
          var previous = previouslyWatched[previousLevel];
          // For previous level and style, 'event' followed it
          if (!additionalWatchedVideos[previousLevel]) additionalWatchedVideos[previousLevel] = {};
          if (!additionalWatchedVideos[previousLevel][previousStyle]) {
            additionalWatchedVideos[previousLevel][previousStyle] = {};
          }
          // TODO: care which video watched next?
          if (!additionalWatchedVideos[previousLevel][previousStyle][event]) {
            additionalWatchedVideos[previousLevel][previousStyle][event] = 0;
          }
          additionalWatchedVideos[previousLevel][previousStyle][event]++;
          
          if (previousLevel === 'the-second-kithmaze') {
            print("Followed the-second-kithmaze " + userID + " " + level + " " + event + " " + created);
          }
        }
      }

      // Add level/style to previouslyWatched for this user
      if (!previouslyWatched[level]) previouslyWatched[level] = {};
      if (!previouslyWatched[level][style]) previouslyWatched[level][style] = true;
    }
  }

  print("Sorting additional watched videos by started event counts...");
  var additionalWatchedVideoByStarted = [];
  for (levelID in additionalWatchedVideos) {
    for (style in additionalWatchedVideos[levelID]) {
      var started = 0;
      var finished = 0;
      for (event in additionalWatchedVideos[levelID][style]) {
        if (event === "Start help video") started += additionalWatchedVideos[levelID][style][event];
        else if (event === "Finish help video") finished += additionalWatchedVideos[levelID][style][event];
        else throw new Error("Unknown event " + event);
      }
      var data = {
        level: levelID,
        style: style,
        started: started,
        finished: finished
      };
      if (finished > 0) data['rate'] = finished / started * 100;
      additionalWatchedVideoByStarted.push(data);
    }
  }
  additionalWatchedVideoByStarted.sort(function(a,b) {
    if (a.level !== b.level) {
      if (a.level < b.level) return -1;
      else return 1;
    }
    return b.started - a.started;
  });

  print("Per-level additional videos watched:");
  print("For a given level and style, this is how many more videos were started and finished.");
  print("Columns: level, style, started, finished, additionals completion rate");
  for (var i = 0; i < additionalWatchedVideoByStarted.length; i++) {
    var item = additionalWatchedVideoByStarted[i];
    var msg = item.level + "\t" + item.style + (item.style === 'edited' ? "\t\t" : "\t") + item.started + "\t" + item.finished;
    if (item['rate']) msg += "\t" + item.rate + "%";
    print(msg);
  }
}

function printSubConversionTotals() {
  // For a user, who started a video, did they subscribe afterwards?

  // Find each started event, per user
  print("Querying for help video start events...");
  var eventsCursor = db['analytics.log.events'].find({
    $and: [
      {"created": { $gte: ISODate(testStartDate)}},
      {$or : [
        {"event": "Start help video"},
        {"event": "Finished subscription purchase"}
        ]}
    ]
  });

  print("Building per-user events progression data...");
  // Find event progression per-user
  var eventsProgression = {};
  while (eventsCursor.hasNext()) {
    var doc = eventsCursor.next();
    var event = doc.event;
    var userID = doc.user.valueOf();
    var created = doc.created
    var levelID = doc.properties.level;
    var style = doc.properties.style;
    
    if (!eventsProgression[userID]) eventsProgression[userID] = [];
    eventsProgression[userID].push({
      style: style,
      level: levelID,
      event: event,
      created: created.toISOString()
    })
    // if (event === 'Finished subscription purchase')
    //   printjson(eventsProgression[userID]);
  }
  // printjson(eventsProgression);

  print("Sorting per-user events progression data...");
  for (userID in eventsProgression) eventsProgression[userID].sort(function (a,b) {return a.created < b.created ? -1 : 1});
  
  
  print("Building per-level/style sub purchases..");
  // Build: <level><style><count>
  var subPurchaseCounts = {};
  for (userID in eventsProgression) {
    var history = eventsProgression[userID];
    for (var i = 0; i < history.length; i++) {
      if (history[i].event === 'Finished subscription purchase') {
        var item = i > 0 ? history[i - 1] : {level: 'unknown', style: 'unknown'};
        // if (i === 0) {
        //   print(userID);
        //   printjson(history[i]);
        // }
        if (!subPurchaseCounts[item.level]) subPurchaseCounts[item.level] = {};
        if (!subPurchaseCounts[item.level][item.style]) subPurchaseCounts[item.level][item.style] = 0;
        subPurchaseCounts[item.level][item.style]++;
      }
    }
  }
  // printjson(subPurchaseCounts);
  
  print("Sorting per-level/style sub purchase counts...");
  var subPurchasesByTotal = [];
  for (levelID in subPurchaseCounts) {
    for (style in subPurchaseCounts[levelID]) {
      subPurchasesByTotal.push({
        level: levelID,
        style: style,
        total: subPurchaseCounts[levelID][style]
      })
    }
  }
  subPurchasesByTotal.sort(function (a,b) {
    if (a.level !== b.level) return a.level < b.level ? -1 : 1;
    return b.total - a.total;
  });
  
  print("Per-level/style following sub purchases:");
  print("Columns: level, style, following sub purchases.");
  print("'unknown' means no preceding start help video event.");
  for (var i = 0; i < subPurchasesByTotal.length; i++) {
    var item = subPurchasesByTotal[i];
    print(item.level + "\t" + item.style + (item.style === 'edited' ? "\t\t" : "\t") + item.total);
  }
}

printVideoCompletionRates();
printWatchedAnotherVideoRates();
printSubConversionTotals();