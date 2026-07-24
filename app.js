rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    function isAdmin() {
      return signedIn()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
    }

    function validCompetitionId(value) {
      return value in ['ligue1', 'liga', 'serieA', 'premierLeague', 'ldc'];
    }

    function validMatchCreate() {
      return request.resource.data.keys().hasOnly([
          'competitionId',
          'roundLabel',
          'homeTeam',
          'awayTeam',
          'kickoff',
          'createdAt'
        ])
        && request.resource.data.competitionId is string
        && validCompetitionId(request.resource.data.competitionId)
        && request.resource.data.roundLabel is string
        && request.resource.data.homeTeam is string
        && request.resource.data.awayTeam is string
        && request.resource.data.kickoff is timestamp;
    }

    function validMatchUpdate() {
      return request.resource.data.keys().hasOnly([
          'competitionId',
          'roundLabel',
          'homeTeam',
          'awayTeam',
          'kickoff',
          'createdAt',
          'homeScore',
          'awayScore',
          'resultUpdatedAt'
        ])
        && request.resource.data.competitionId is string
        && validCompetitionId(request.resource.data.competitionId)
        && request.resource.data.roundLabel is string
        && request.resource.data.homeTeam is string
        && request.resource.data.awayTeam is string
        && request.resource.data.kickoff is timestamp
        && (!('homeScore' in request.resource.data) || request.resource.data.homeScore is int)
        && (!('awayScore' in request.resource.data) || request.resource.data.awayScore is int);
    }

    function validUserCreate(uid) {
      return request.resource.data.keys().hasOnly([
          'uid',
          'email',
          'displayName',
          'isAdmin',
          'createdAt'
        ])
        && request.resource.data.uid == uid
        && request.resource.data.email is string
        && request.resource.data.displayName is string
        && request.resource.data.isAdmin is bool;
    }

    function validUserSelfUpdate(uid) {
      return request.resource.data.keys().hasOnly([
          'uid',
          'email',
          'displayName',
          'isAdmin',
          'createdAt'
        ])
        && request.resource.data.uid == uid
        && request.resource.data.email is string
        && request.resource.data.displayName is string
        && request.resource.data.isAdmin == resource.data.isAdmin
        && request.resource.data.createdAt == resource.data.createdAt;
    }

    function validPredictionCreate() {
      return request.resource.data.keys().hasOnly([
          'matchId',
          'competitionId',
          'userId',
          'predHome',
          'predAway',
          'createdAt',
          'updatedAt'
        ])
        && request.resource.data.matchId is string
        && request.resource.data.competitionId is string
        && validCompetitionId(request.resource.data.competitionId)
        && request.resource.data.userId == request.auth.uid
        && request.resource.data.predHome is int
        && request.resource.data.predAway is int
        && request.resource.data.predHome >= 0
        && request.resource.data.predAway >= 0
        && exists(/databases/$(database)/documents/matches/$(request.resource.data.matchId))
        && get(/databases/$(database)/documents/matches/$(request.resource.data.matchId)).data.competitionId
           == request.resource.data.competitionId;
    }

    function validPredictionUpdate() {
      return request.resource.data.keys().hasOnly([
          'matchId',
          'competitionId',
          'userId',
          'predHome',
          'predAway',
          'createdAt',
          'updatedAt'
        ])
        && request.resource.data.matchId == resource.data.matchId
        && request.resource.data.competitionId == resource.data.competitionId
        && request.resource.data.userId == resource.data.userId
        && request.resource.data.userId == request.auth.uid
        && request.resource.data.predHome is int
        && request.resource.data.predAway is int
        && request.resource.data.predHome >= 0
        && request.resource.data.predAway >= 0
        && request.resource.data.createdAt == resource.data.createdAt;
    }

    match /users/{uid} {
      allow read: if signedIn();

      allow create: if isOwner(uid) && validUserCreate(uid);

      allow update: if (
          isOwner(uid) && validUserSelfUpdate(uid)
        ) || (
          isAdmin()
          && request.resource.data.keys().hasOnly([
            'uid',
            'email',
            'displayName',
            'isAdmin',
            'createdAt'
          ])
          && request.resource.data.uid == uid
          && request.resource.data.email is string
          && request.resource.data.displayName is string
          && request.resource.data.isAdmin is bool
        );

      allow delete: if false;
    }

    match /matches/{matchId} {
      allow read: if signedIn();
      allow create: if isAdmin() && validMatchCreate();
      allow update: if isAdmin() && validMatchUpdate();
      allow delete: if isAdmin();
    }

    match /predictions/{predictionId} {
      allow read: if signedIn();

      allow create: if signedIn() && validPredictionCreate();

      allow update: if signedIn()
        && isOwner(resource.data.userId)
        && validPredictionUpdate()
        && exists(/databases/$(database)/documents/matches/$(resource.data.matchId))
        && request.time < get(/databases/$(database)/documents/matches/$(resource.data.matchId)).data.kickoff;

      allow delete: if isAdmin();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
