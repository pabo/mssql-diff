# mssql-diff

## Purpose
What's that functionality in your app **actually do** to the database? Where do all the tendrils of your code **reach out and touch**? Find out.

This util will connect to your mssql database, take a snapshot, and wait for your signal. Meanwhile, you go through some workflow in your app. Then you signal this util and it takes another snapshot of your database and presents you with a sensible diff of what changed.

## Usage

```
$ npx mssql-diff --help

Options:
      --help       Show help                                           [boolean]
      --version    Show version number                                 [boolean]
  -S, --server     mssql server             [string] [default: "localhost,1433"]
  -U, --user       mssql user                                [string] [required]
  -P, --password   mssql password                            [string] [required]
  -d, --database   mssql database                            [string] [required]
  -t, --tenant     tenant name                                          [string]
  -f, --filter     filter out dupes and boilerplate    [boolean] [default: true]
  -m, --summarize  summarize output to make it clearer [boolean] [default: true]
```

## Example

```
$ npx mssql-diff -P '$uper$ecurepa$$word' -d 'my_database_name'

First db snapshot taken. Take some action in the app that will affect the database before taking the next snapshot.
[Enter] to take next snapshot...
```

Then you go and change an appointment start time, and resume the util to see what actually changed in the db...

```
[
  {
    kind: 'Edit',
    path: 'Appointment.2.Start',
    old: 2021-10-26T15:00:00.000Z,
    new: 2021-10-26T13:00:00.000Z
  },
  {
    kind: 'Edit',
    path: 'Appointment.2.Duration',
    old: '7200000000000',
    new: '10800000000000'
  },
  {
    kind: 'Edit',
    path: 'Appointment.2.ExpectedDuration',
    old: '7200000000000',
    new: '10800000000000'
  },
]
```

Voila!
