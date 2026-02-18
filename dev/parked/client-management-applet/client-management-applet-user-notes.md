**Notes on field selection and management**

- gender: Should be a drop down that looks like the following:

```
Binary
  - Male
  - Female
Other [Note to agent: enable text capture if selected]
```

**Note to agent: The /settings should have a slider that enables the panopoly of gender choices beyond binary

- pronouns: will also be a drop-down

```
He/Him/His 
She/Her/Hers
They/Them/Theirs
Ze/Hir/Hirs 
Other [Note to agent: allow textual input if selected]
```

- Race: will be a drop down

```
American Indian or Alaska Native
Asian
Black or African American
Native Hawaiian or Other Pacific Islander
White
Two or more Races
Prefer not to say
```

- Ethnicity: this is also a drop-down

```
Hispanic or Latino
Not Hispanic or Latino
Prefer not to say
```

- Primary Language: will be a drop-down

```
Arabic
Bengali
Cantonese 
English
French
German
Hindi
Japanese
Karen 
Lahnda
Mandarin
Marathi
Portugese
Russian
Spanish
Swahili
Tagalog
Tamil
Turkish
Urudu
Vietnamese
```

- case_number: This should actually be called internal_case_number. This should be a renamable custom field.  This is the tenant facing unique identifier for the client.

- discharge_date: This should be an event in the system on it's own registered in AsyncAPI.  It's visual representation can exist in the client management page.  Once the client.discharge event has been fired, an event called client.reverse_discharge should be made available with a corresponding new button (maybe? ).  client.reverse_discharege is meant to undo an accident or unintended dischage.

**Note:**  We will need to be able to also have functionality that allows for the re-admittance of a previously discharged client.  This is **not** a client.reverse_discharge.  This is to accomodatge the scenario for when a provider has served the client in the past and has been re-contracted to serve the client again.

- external_case_number_1: This should be a renamable custom field.
- external_case_number_2: This should be a renamable custom field.
- external_case_number_3: This should be a renamable custom field.

Note to agent:  There will be no court_case_number.

- status: This should be renamable and mappable as well.  Its canonical domain of values: IN_PROGRAM, OUT_OF_PROGRAM_WORK, OUT_OF_PROGRAM_HOME_VISIT, OUT_OF_PROGRAM_OFF_CAMPUS, OUT_OF_PROGRAM_AWOL, OUT_OF_PROGRAM_HOSPITAL, OUT_OF_PROGRAM_SCHOOLING, OUT_OF_PROGRAM_DETENTION
